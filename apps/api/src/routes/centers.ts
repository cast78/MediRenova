import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { auditLog } from "../lib/audit.js";
import { stripUndefined } from "../lib/utils.js";

// Acepta CIF, NIF o NIE españoles (sin verificar dígito de control). Se normaliza a mayúsculas.
const cifRegex = /^([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Za-z]|[XYZ]\d{7}[A-Za-z])$/i;

const centerSchema = z.object({
  name: z.string().min(2).max(100),
  cif: z
    .string()
    .trim()
    .regex(cifRegex, "CIF/NIF inválido")
    .transform((s) => s.toUpperCase())
    .optional(),
  address: z.string().min(5),
  city: z.string().min(2),
  province: z.string().min(2),
  postalCode: z.string().min(4).max(10),
  phones: z.array(z.string().trim().min(5).max(30)).max(10).optional(),
  emails: z.array(z.string().trim().email()).max(10).optional(),
  active: z.boolean().optional(),
});

// Room schedule stored as JSON: { openTime, closeTime, activeDays, slotDuration, slotBuffer }
const roomScheduleSchema = z.object({
  openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  activeDays: z.array(z.number().int().min(0).max(6)).optional(),
  slotDuration: z.number().int().min(5).max(120).optional(),
  slotBuffer: z.number().int().min(0).max(60).optional(),
});

const roomSchema = z.object({
  name: z.string().min(1).max(80),
  schedule: roomScheduleSchema.optional(),
  allowedProductTypes: z.array(z.string()).optional(),
});

const assignDoctorSchema = z.object({ userId: z.string().uuid() });

export async function centerRoutes(server: FastifyInstance) {
  server.get("/centers", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const centers = await prisma.center.findMany({
        where: { tenantId: request.ctx.tenantId },
        include: { rooms: { include: { doctors: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } } } } },
        orderBy: { name: "asc" },
      });
      return reply.send({ data: centers, errors: null });
    });

  server.post("/centers", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = centerSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const center = await prisma.center.create({ data: { tenantId: request.ctx.tenantId, ...body.data } as any });
      await auditLog({ tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip }, "CREATE", "center", center.id, { after: center });
      return reply.status(201).send({ data: center, errors: null });
    });

  server.get<{ Params: { id: string } }>("/centers/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, include: { rooms: true } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: center, errors: null });
    });

  server.patch<{ Params: { id: string }; Querystring: { force?: string } }>("/centers/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = centerSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      // 5.2: desactivar un centro con reservas futuras requiere confirmación explícita
      if (body.data.active === false && request.query.force !== "true") {
        const futureCount = await prisma.appointment.count({
          where: {
            tenantId: request.ctx.tenantId,
            room: { centerId: request.params.id },
            scheduledAt: { gt: new Date() },
            status: { in: ["CONFIRMED", "PENDING"] },
          },
        });
        if (futureCount > 0) {
          return reply.status(409).send({
            errors: [{ code: "CONFLICT", message: `El centro tiene ${futureCount} reserva(s) futura(s). Reenvía con ?force=true para confirmar.`, count: futureCount }],
          });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await prisma.center.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: stripUndefined(body.data) as any });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  server.delete<{ Params: { id: string } }>("/centers/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.center.deleteMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      return reply.status(204).send();
    });

  // ── ROOMS ──────────────────────────────────────────────────────────────

  server.get<{ Params: { centerId: string } }>("/centers/:centerId/rooms", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.centerId, tenantId: request.ctx.tenantId } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const rooms = await prisma.room.findMany({
        where: { centerId: request.params.centerId },
        include: { doctors: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
        orderBy: { name: "asc" },
      });
      return reply.send({ data: rooms, errors: null });
    });

  server.post<{ Params: { centerId: string } }>("/centers/:centerId/rooms", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.centerId, tenantId: request.ctx.tenantId } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const body = roomSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const room = await prisma.room.create({
        data: { centerId: request.params.centerId, name: body.data.name, schedule: body.data.schedule ?? {}, allowedProductTypes: body.data.allowedProductTypes ?? [] },
      });
      return reply.status(201).send({ data: room, errors: null });
    });

  server.patch<{ Params: { centerId: string; roomId: string } }>("/centers/:centerId/rooms/:roomId", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.centerId, tenantId: request.ctx.tenantId } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const body = roomSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const updateData: Record<string, unknown> = {};
      if (body.data.name) updateData["name"] = body.data.name;
      if (body.data.schedule) updateData["schedule"] = body.data.schedule;
      if (body.data.allowedProductTypes) updateData["allowedProductTypes"] = body.data.allowedProductTypes;
      const room = await prisma.room.updateMany({ where: { id: request.params.roomId, centerId: request.params.centerId }, data: updateData });
      if (room.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  server.delete<{ Params: { centerId: string; roomId: string } }>("/centers/:centerId/rooms/:roomId", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.centerId, tenantId: request.ctx.tenantId } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      await prisma.room.deleteMany({ where: { id: request.params.roomId, centerId: request.params.centerId } });
      return reply.status(204).send();
    });

  server.post<{ Params: { centerId: string; roomId: string } }>("/centers/:centerId/rooms/:roomId/doctors", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.centerId, tenantId: request.ctx.tenantId } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const body = assignDoctorSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      await prisma.roomDoctor.upsert({
        where: { roomId_userId: { roomId: request.params.roomId, userId: body.data.userId } },
        update: {},
        create: { roomId: request.params.roomId, userId: body.data.userId },
      });
      return reply.status(201).send({ data: { assigned: true }, errors: null });
    });

  server.delete<{ Params: { centerId: string; roomId: string; doctorId: string } }>("/centers/:centerId/rooms/:roomId/doctors/:doctorId",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.roomDoctor.deleteMany({ where: { roomId: request.params.roomId, userId: request.params.doctorId } });
      return reply.status(204).send();
    });
}
