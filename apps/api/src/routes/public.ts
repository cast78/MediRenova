import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encryptDni } from "../lib/crypto.js";
import { validateSpanishDni, hashDni } from "../lib/dni.js";
import { computeDaySlots, productAllowedInRoom } from "../lib/availability.js";
import { roomHasOverlap } from "../lib/booking.js";

// ── Envelope (tarea 14.7) ────────────────────────────────────────────────────
function ok(reply: FastifyReply, data: unknown, status = 200) {
  return reply.status(status).send({ success: true, data });
}
function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

// ── Rate limit por API Key (in-memory, MVP — tarea 14.2) ─────────────────────
const LIMIT = 1000;
const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();
function consume(keyId: string): { limited: boolean; remaining: number } {
  const now = Date.now();
  let b = buckets.get(keyId);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + WINDOW_MS }; buckets.set(keyId, b); }
  b.count++;
  return { limited: b.count > LIMIT, remaining: Math.max(0, LIMIT - b.count) };
}

const publicCustomerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  dni: z.string().min(7).max(15),
  birthDate: z.string().datetime().optional(),
  province: z.string().optional(),
  municipality: z.string().optional(),
  gdprConsent: z.boolean(),
});

const publicAppointmentSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  roomId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sched = { openTime?: string; closeTime?: string; activeDays?: number[] };

export async function publicApiRoutes(server: FastifyInstance) {
  // Rate limit (la auth por API Key ya la garantiza el plugin global).
  server.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith("/api/v1/public/")) return;
    if (!request.ctx) return fail(reply, 401, "UNAUTHORIZED", "API Key requerida");
    const rl = consume(request.ctx.userId);
    reply.header("X-RateLimit-Limit", String(LIMIT)).header("X-RateLimit-Remaining", String(rl.remaining));
    if (rl.limited) return fail(reply, 429, "RATE_LIMITED", "Límite de peticiones excedido (1000/hora)");
  });

  // GET /public/v1/products
  server.get("/public/v1/products", async (request: FastifyRequest, reply: FastifyReply) => {
    const products = await prisma.product.findMany({
      where: { tenantId: request.ctx.tenantId, active: true },
      select: { id: true, name: true, type: true, slotDuration: true },
      orderBy: { name: "asc" },
    });
    return ok(reply, products);
  });

  // GET /public/v1/centers
  server.get("/public/v1/centers", async (request: FastifyRequest, reply: FastifyReply) => {
    const centers = await prisma.center.findMany({
      where: { tenantId: request.ctx.tenantId, active: true },
      select: {
        id: true, name: true, address: true, city: true, province: true, postalCode: true, phones: true,
        rooms: { where: { active: true }, select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
    return ok(reply, centers);
  });

  // GET /public/v1/centers/:id/availability?productId&date
  server.get<{ Params: { id: string } }>("/public/v1/centers/:id/availability",
    async (request, reply: FastifyReply) => {
      const q = z.object({ productId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(request.query);
      if (!q.success) return fail(reply, 400, "BAD_REQUEST", "Se requieren productId y date (YYYY-MM-DD)");

      const center = await prisma.center.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, active: true },
        select: { holidays: true, rooms: { where: { active: true }, select: { id: true, name: true, schedule: true, allowedProductIds: true } } },
      });
      if (!center) return fail(reply, 404, "NOT_FOUND", "Centro no encontrado");
      const product = await prisma.product.findFirst({ where: { id: q.data.productId, tenantId: request.ctx.tenantId, active: true } });
      if (!product) return fail(reply, 400, "INVALID_PRODUCT", "Producto no válido");

      const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId } });
      const step = config?.bookingGranularity ?? 15;
      const holidays = (center.holidays as string[] | null) ?? [];
      const dayStart = new Date(`${q.data.date}T00:00:00.000Z`);
      const dayEnd = new Date(`${q.data.date}T23:59:59.999Z`);

      const rooms: { roomId: string; roomName: string; slots: string[] }[] = [];
      for (const room of center.rooms) {
        if (!productAllowedInRoom(room.allowedProductIds, product.id)) continue;
        const sched = (room.schedule as Sched | null) ?? {};
        const existing = await prisma.appointment.findMany({
          where: { roomId: room.id, scheduledAt: { gte: dayStart, lte: dayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { scheduledAt: true, durationMinutes: true },
        });
        const booked = existing.map((a) => ({ start: a.scheduledAt.getTime(), end: a.scheduledAt.getTime() + a.durationMinutes * 60_000 }));
        const slots = computeDaySlots({
          date: q.data.date, openTime: sched.openTime ?? "08:00", closeTime: sched.closeTime ?? "20:00",
          activeDays: sched.activeDays, slotDuration: product.slotDuration, step, booked, isHoliday: holidays.includes(q.data.date),
        });
        rooms.push({ roomId: room.id, roomName: room.name, slots });
      }
      return ok(reply, { date: q.data.date, rooms });
    });

  // POST /public/v1/customers
  server.post("/public/v1/customers", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = publicCustomerSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, "VALIDATION_ERROR", "Datos inválidos");
    if (!validateSpanishDni(body.data.dni)) return fail(reply, 400, "INVALID_DNI", "DNI/NIE con letra de control incorrecta");
    if (!body.data.gdprConsent) return fail(reply, 400, "GDPR_CONSENT_REQUIRED", "Se requiere el consentimiento GDPR");

    const dniHash = hashDni(body.data.dni);
    const existing = await prisma.customer.findFirst({ where: { tenantId: request.ctx.tenantId, dniHash } });
    if (existing) return ok(reply, { id: existing.id, existed: true });

    const customer = await prisma.customer.create({
      data: {
        tenantId: request.ctx.tenantId,
        firstName: body.data.firstName,
        lastName: body.data.lastName,
        email: body.data.email ?? null,
        phone: body.data.phone ?? null,
        province: body.data.province ?? null,
        municipality: body.data.municipality ?? null,
        dniHash,
        dniEncrypted: encryptDni(body.data.dni),
        birthDate: body.data.birthDate ? new Date(body.data.birthDate) : null,
        gdprConsentAt: new Date(),
        gdprConsentIp: request.ip,
      },
      select: { id: true },
    });
    return ok(reply, { id: customer.id, existed: false }, 201);
  });

  // POST /public/v1/appointments — con bloqueo de solape (igual que el público)
  server.post("/public/v1/appointments", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = publicAppointmentSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, "VALIDATION_ERROR", "Datos inválidos");

    const [customer, product, room] = await Promise.all([
      prisma.customer.findFirst({ where: { id: body.data.customerId, tenantId: request.ctx.tenantId, deletedAt: null } }),
      prisma.product.findFirst({ where: { id: body.data.productId, tenantId: request.ctx.tenantId, active: true } }),
      prisma.room.findFirst({ where: { id: body.data.roomId, center: { tenantId: request.ctx.tenantId, active: true }, active: true } }),
    ]);
    if (!customer) return fail(reply, 400, "INVALID_CUSTOMER", "Cliente no válido");
    if (!product) return fail(reply, 400, "INVALID_PRODUCT", "Producto no válido");
    if (!room) return fail(reply, 400, "INVALID_ROOM", "Sala no válida");
    if (!productAllowedInRoom(room.allowedProductIds, product.id)) return fail(reply, 400, "PRODUCT_NOT_ALLOWED_IN_ROOM", "El producto no se ofrece en esa sala");

    const start = new Date(body.data.scheduledAt);
    if (await roomHasOverlap(body.data.roomId, start, product.slotDuration)) {
      return fail(reply, 409, "SLOT_TAKEN", "La franja ya está reservada");
    }

    const appointment = await prisma.appointment.create({
      data: {
        tenantId: request.ctx.tenantId,
        customerId: body.data.customerId,
        productId: body.data.productId,
        roomId: body.data.roomId,
        scheduledAt: start,
        durationMinutes: product.slotDuration,
        source: "API",
        status: "CONFIRMED",
      },
      select: { id: true, scheduledAt: true, status: true },
    });
    return ok(reply, appointment, 201);
  });
}
