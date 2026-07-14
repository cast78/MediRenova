import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signMagicLinkToken, verifyMagicLinkToken } from "../lib/jwt.js";
import { requireRole } from "../lib/authorization.js";
import { markWorkflowConverted } from "../lib/workflow-cron.js";
import { computeDaySlots, productAllowedInRoom, nowInTimezone } from "../lib/availability.js";
import { roomHasOverlap } from "../lib/booking.js";

const confirmSchema = z.object({
  roomId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
});

const rescheduleSchema = z.object({
  roomId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  appointmentId: z.string().uuid(), // existing appointment to cancel
});

type MagicRoomSchedule = {
  slotsByDay?: Record<string, string[]>;
};

export async function magicLinkRoutes(server: FastifyInstance) {
  // GET /link/:token — validate and return booking context
  server.get<{ Params: { token: string } }>("/link/:token",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);

        const [customer, product] = await Promise.all([
          prisma.customer.findFirst({ where: { id: payload.cid, tenantId: payload.tid, deletedAt: null } }),
          prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } }),
        ]);

        if (!customer || !product) {
          return reply.status(404).send({ errors: [{ code: "NOT_FOUND", message: "Enlace inválido" }] });
        }

        // Get centers with rooms for this tenant
        const centers = await prisma.center.findMany({
          where: { tenantId: payload.tid, active: true },
          include: {
            rooms: {
              where: { active: true },
              select: { id: true, name: true, schedule: true },
            },
          },
        });

        return reply.send({
          data: {
            customer: { firstName: customer.firstName, lastName: customer.lastName },
            product: { id: product.id, name: product.name, slotDuration: product.slotDuration },
            centers,
            tokenPayload: { cid: payload.cid, pid: payload.pid, tid: payload.tid },
          },
          errors: null,
        });
      } catch {
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN", message: "Enlace expirado o inválido" }] });
      }
    });

  // ── Confirmación de cita por enlace (cliente, sin login) ─────────────────────
  const apptDetailSelect = {
    id: true, scheduledAt: true, durationMinutes: true, status: true,
    product: { select: { name: true } },
    room: { select: { name: true, center: { select: { name: true, address: true, city: true, lat: true, lng: true } } } },
    customer: { select: { firstName: true, lastName: true } },
  } as const;

  // GET /link/:token/appointment — datos de la cita para la página de confirmación
  server.get<{ Params: { token: string } }>("/link/:token/appointment",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        if (!payload.aid) return reply.status(400).send({ errors: [{ code: "NOT_CONFIRMATION_LINK", message: "Enlace no válido para confirmar" }] });
        const appt = await prisma.appointment.findFirst({ where: { id: payload.aid, tenantId: payload.tid }, select: apptDetailSelect });
        if (!appt) return reply.status(404).send({ errors: [{ code: "NOT_FOUND", message: "Cita no encontrada" }] });
        return reply.send({ data: appt, errors: null });
      } catch {
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN", message: "Enlace expirado o inválido" }] });
      }
    });

  // Confirmar o cancelar ("No podré ir") una cita PENDIENTE/CONFIRMADA por token.
  async function actOnAppointment(token: string, action: "CONFIRMED" | "CANCELLED", reply: FastifyReply) {
    try {
      const payload = verifyMagicLinkToken(token);
      if (!payload.aid) return reply.status(400).send({ errors: [{ code: "NOT_CONFIRMATION_LINK" }] });
      const appt = await prisma.appointment.findFirst({ where: { id: payload.aid, tenantId: payload.tid }, select: { id: true, status: true } });
      if (!appt) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
        // Ya cerrada por otra vía (recepción, atendida…). Se informa el estado actual.
        return reply.status(409).send({ errors: [{ code: "NOT_ACTIONABLE", message: "Esta cita ya no admite cambios." }], data: { status: appt.status } });
      }
      await prisma.appointment.update({
        where: { id: appt.id },
        data: action === "CANCELLED" ? { status: "CANCELLED", cancelReason: "CLIENTE" } : { status: "CONFIRMED" },
      });
      // Registra la acción DEL CLIENTE en su historial (por enlace, sin login).
      await prisma.customerEvent.create({ data: { tenantId: payload.tid, customerId: payload.cid, appointmentId: appt.id, type: action === "CANCELLED" ? "cliente_cancelo" : "cliente_confirmo", actor: "cliente" } }).catch(() => {});
      return reply.send({ data: { status: action }, errors: null });
    } catch {
      return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN", message: "Enlace expirado o inválido" }] });
    }
  }

  // POST /link/:token/appointment/confirm
  server.post<{ Params: { token: string } }>("/link/:token/appointment/confirm",
    async (request, reply: FastifyReply) => actOnAppointment(request.params.token, "CONFIRMED", reply));

  // POST /link/:token/appointment/cancel — "No podré ir" (auto-cancelación del cliente)
  server.post<{ Params: { token: string } }>("/link/:token/appointment/cancel",
    async (request, reply: FastifyReply) => actOnAppointment(request.params.token, "CANCELLED", reply));

  // POST /link/:token/confirm — book slot
  server.post<{ Params: { token: string } }>("/link/:token/confirm",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        const body = confirmSchema.safeParse(request.body);
        if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

        const product = await prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } });
        if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });

        const room = await prisma.room.findFirst({
          where: { id: body.data.roomId, center: { tenantId: payload.tid, active: true } },
        });
        if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });
        if (!productAllowedInRoom(room.allowedProductIds, payload.pid)) return reply.status(400).send({ errors: [{ code: "PRODUCT_NOT_ALLOWED_IN_ROOM" }] });
        // El flujo público (paciente) NO permite solapar.
        if (await roomHasOverlap(body.data.roomId, new Date(body.data.scheduledAt), product.slotDuration)) {
          return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada, elige otra" }] });
        }

        try {
          const appointment = await prisma.appointment.create({
            data: {
              tenantId: payload.tid,
              customerId: payload.cid,
              productId: payload.pid,
              roomId: body.data.roomId,
              scheduledAt: new Date(body.data.scheduledAt),
              durationMinutes: product.slotDuration,
              source: "MAGIC_LINK",
              status: "CONFIRMED",
            },
          });
          await markWorkflowConverted(payload.tid, payload.cid, payload.pid).catch(() => {});
          return reply.status(201).send({ data: { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt }, errors: null });
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("unique constraint")) {
            return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada, elige otra" }] });
          }
          throw err;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique constraint")) throw err;
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN" }] });
      }
    });

  // GET /link/:token/slots — available slots (public, no auth required)
  server.get<{ Params: { token: string }; Querystring: { roomId: string; date: string } }>("/link/:token/slots",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        const { roomId, date } = request.query as { roomId?: string; date?: string };

        if (!roomId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return reply.status(400).send({ errors: [{ code: "BAD_REQUEST", message: "roomId y date son requeridos" }] });
        }

        const room = await prisma.room.findFirst({
          where: { id: roomId, center: { tenantId: payload.tid, active: true }, active: true },
          include: { center: { select: { holidays: true } } },
        });
        if (!room) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
        // Sin disponibilidad si la sala no ofrece el producto del enlace.
        if (!productAllowedInRoom(room.allowedProductIds, payload.pid)) {
          return reply.send({ data: [], errors: null });
        }

        const roomSchedule = (room.schedule as MagicRoomSchedule | null) ?? {};
        const product = await prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } });
        const config = await prisma.tenantConfig.findUnique({ where: { tenantId: payload.tid } });
        const slotDuration = product?.slotDuration ?? config?.defaultSlotDuration ?? 20;

        const dayStart = new Date(`${date}T00:00:00.000Z`);
        const dayEnd = new Date(`${date}T23:59:59.999Z`);
        const existing = await prisma.appointment.findMany({
          where: { roomId, scheduledAt: { gte: dayStart, lte: dayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { scheduledAt: true, durationMinutes: true },
        });
        const booked = existing.map((a) => ({ start: a.scheduledAt.getTime(), end: a.scheduledAt.getTime() + a.durationMinutes * 60_000 }));

        const holidays = (room.center.holidays as string[] | null) ?? [];
        const slots = computeDaySlots({
          date,
          slotsByDay: roomSchedule.slotsByDay,
          slotDuration,
          booked,
          isHoliday: holidays.includes(date),
          now: nowInTimezone(config?.timezone || "Europe/Madrid"),
          leadMinutes: (config?.minBookingLeadHours ?? 0) * 60,
        });

        return reply.send({ data: slots, errors: null });
      } catch {
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN", message: "Enlace expirado o inválido" }] });
      }
    });

  // GET /link/:token/next-availability — próximos días con hueco.
  // 10.5: busca en 7 días; si no hay ninguno, expande la búsqueda a 30 días.
  server.get<{ Params: { token: string }; Querystring: { roomId: string } }>("/link/:token/next-availability",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        const { roomId } = request.query as { roomId?: string };
        if (!roomId) return reply.status(400).send({ errors: [{ code: "BAD_REQUEST", message: "roomId requerido" }] });

        const room = await prisma.room.findFirst({
          where: { id: roomId, center: { tenantId: payload.tid, active: true }, active: true },
          include: { center: { select: { holidays: true } } },
        });
        if (!room) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
        // Sin disponibilidad si la sala no ofrece el producto del enlace.
        if (!productAllowedInRoom(room.allowedProductIds, payload.pid)) {
          return reply.send({ data: { window: 7, days: [] }, errors: null });
        }

        const roomSchedule = (room.schedule as MagicRoomSchedule | null) ?? {};
        const product = await prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } });
        const config = await prisma.tenantConfig.findUnique({ where: { tenantId: payload.tid } });
        const slotDuration = product?.slotDuration ?? config?.defaultSlotDuration ?? 20;

        const today = new Date(); today.setUTCHours(0, 0, 0, 0);
        const rangeEnd = new Date(today); rangeEnd.setDate(rangeEnd.getDate() + 30);
        const existing = await prisma.appointment.findMany({
          where: { roomId, scheduledAt: { gte: today, lte: rangeEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { scheduledAt: true, durationMinutes: true },
        });
        const booked = existing.map((a) => ({ start: a.scheduledAt.getTime(), end: a.scheduledAt.getTime() + a.durationMinutes * 60_000 }));
        const holidays = (room.center.holidays as string[] | null) ?? [];

        const now = nowInTimezone(config?.timezone || "Europe/Madrid");
        const collect = (maxDays: number) => {
          const out: { date: string; slots: string[] }[] = [];
          for (let i = 0; i < maxDays; i++) {
            const d = new Date(today); d.setDate(d.getDate() + i);
            const date = d.toISOString().slice(0, 10);
            const slots = computeDaySlots({
              date,
              slotsByDay: roomSchedule.slotsByDay,
              slotDuration,
              booked,
              isHoliday: holidays.includes(date),
              now,
              leadMinutes: (config?.minBookingLeadHours ?? 0) * 60,
            });
            if (slots.length) out.push({ date, slots });
          }
          return out;
        };

        let days = collect(7);
        let window = 7;
        if (days.length === 0) { days = collect(30); window = 30; }

        return reply.send({ data: { window, days }, errors: null });
      } catch {
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN", message: "Enlace expirado o inválido" }] });
      }
    });

  // POST /link/:token/reschedule — cancel old + book new slot
  server.post<{ Params: { token: string } }>("/link/:token/reschedule",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        const body = rescheduleSchema.safeParse(request.body);
        if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

        const product = await prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } });
        if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });

        const room = await prisma.room.findFirst({ where: { id: body.data.roomId, center: { tenantId: payload.tid, active: true } } });
        if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });
        if (!productAllowedInRoom(room.allowedProductIds, payload.pid)) return reply.status(400).send({ errors: [{ code: "PRODUCT_NOT_ALLOWED_IN_ROOM" }] });

        // Cancel the old appointment (must belong to this customer + tenant)
        await prisma.appointment.updateMany({
          where: { id: body.data.appointmentId, customerId: payload.cid, tenantId: payload.tid, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          data: { status: "CANCELLED" },
        });

        // Tras cancelar la anterior, el público no puede solapar con otras.
        if (await roomHasOverlap(body.data.roomId, new Date(body.data.scheduledAt), product.slotDuration)) {
          return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada, elige otra" }] });
        }

        try {
          const appointment = await prisma.appointment.create({
            data: {
              tenantId: payload.tid,
              customerId: payload.cid,
              productId: payload.pid,
              roomId: body.data.roomId,
              scheduledAt: new Date(body.data.scheduledAt),
              durationMinutes: product.slotDuration,
              source: "MAGIC_LINK",
              status: "CONFIRMED",
            },
          });
          await markWorkflowConverted(payload.tid, payload.cid, payload.pid).catch(() => {});
          return reply.status(201).send({ data: { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt }, errors: null });
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("unique constraint")) {
            return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada, elige otra" }] });
          }
          throw err;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique constraint")) throw err;
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN" }] });
      }
    });

  // POST /link/generate — genera un magic link de auto-reserva (uso interno de staff).
  // Requiere autenticación; el tenant se toma del contexto (no del body) para no poder
  // generar enlaces cross-tenant.
  server.post("/link/generate", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ customerId: z.string().uuid(), productId: z.string().uuid() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const customer = await prisma.customer.findFirst({ where: { id: body.data.customerId, tenantId: request.ctx.tenantId, deletedAt: null }, select: { id: true } });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const token = signMagicLinkToken({ cid: body.data.customerId, pid: body.data.productId, tid: request.ctx.tenantId, type: "magic_link" });
      // Página pública de auto-reserva: /booking/:token (consume la API /link/:token).
      const url = `${process.env["PUBLIC_URL"] ?? "http://localhost:3000"}/booking/${token}`;
      return reply.send({ data: { token, url }, errors: null });
    });
}
