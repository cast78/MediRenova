import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireAnyRole, ROLES_STAFF } from "../lib/authorization.js";
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

const holidaysSchema = z.object({
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD")).max(365),
});

// Room schedule stored as JSON: { slotsByDay: { "0": ["07:00", ...], ... } }.
// Cada sala define qué huecos concretos ofrece cada día de la semana (0=Dom … 6=Sáb),
// para adaptarse a centros pequeños que no trabajan de forma lineal. La duración de
// la cita la marca el producto; aquí solo se eligen las horas de inicio disponibles.
const roomScheduleSchema = z.object({
  slotsByDay: z
    .record(
      z.string().regex(/^[0-6]$/),
      z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(96), // hasta un día completo en tramos de 15 min (00:00–23:45)
    )
    .optional(),
});

const roomSchema = z.object({
  name: z.string().min(1).max(80),
  active: z.boolean().optional(),
  schedule: roomScheduleSchema.optional(),
  allowedProductIds: z.array(z.string().uuid()).max(100).optional(),
});

const assignDoctorSchema = z.object({ userId: z.string().uuid() });

export async function centerRoutes(server: FastifyInstance) {
  server.get("/centers", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const centers = await prisma.center.findMany({
        where: { tenantId: request.ctx.tenantId, ...(request.ctx.centerId ? { id: request.ctx.centerId } : {}) },
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

  server.get<{ Params: { id: string } }>("/centers/:id", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request, reply: FastifyReply) => {
      if (request.ctx.centerId && request.params.id !== request.ctx.centerId) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
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

  // PUT /centers/:id/holidays — fija la lista de festivos del centro (5.5)
  server.put<{ Params: { id: string } }>("/centers/:id/holidays", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = holidaysSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const unique = [...new Set(body.data.holidays)].sort();
      const result = await prisma.center.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: { holidays: unique },
      });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { holidays: unique }, errors: null });
    });

  // ── ROOMS ──────────────────────────────────────────────────────────────

  server.get<{ Params: { centerId: string } }>("/centers/:centerId/rooms", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request, reply: FastifyReply) => {
      if (request.ctx.centerId && request.params.centerId !== request.ctx.centerId) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
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
        data: { centerId: request.params.centerId, name: body.data.name, schedule: body.data.schedule ?? {}, allowedProductIds: body.data.allowedProductIds ?? [] },
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
      if (body.data.active !== undefined) updateData["active"] = body.data.active;
      if (body.data.schedule) updateData["schedule"] = body.data.schedule;
      if (body.data.allowedProductIds) updateData["allowedProductIds"] = body.data.allowedProductIds;
      const room = await prisma.room.updateMany({ where: { id: request.params.roomId, centerId: request.params.centerId }, data: updateData });
      if (room.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  // Impacto de desactivar/eliminar una sala: cuántas citas futuras y pacientes en
  // curso tiene. Lo consume la interfaz para avisar antes de desactivar.
  server.get<{ Params: { centerId: string; roomId: string } }>("/centers/:centerId/rooms/:roomId/impact", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request, reply: FastifyReply) => {
      const room = await prisma.room.findFirst({
        where: { id: request.params.roomId, centerId: request.params.centerId, center: { tenantId: request.ctx.tenantId } },
        select: { id: true },
      });
      if (!room) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const now = new Date();
      const [futureAppointments, totalAppointments, activeVisits] = await Promise.all([
        prisma.appointment.count({ where: { roomId: room.id, scheduledAt: { gte: now }, status: { in: ["PENDING", "CONFIRMED"] } } }),
        prisma.appointment.count({ where: { roomId: room.id } }),
        prisma.visit.count({ where: { currentRoomId: room.id, status: "IN_PROGRESS" } }),
      ]);
      return reply.send({ data: { futureAppointments, totalAppointments, activeVisits }, errors: null });
    });

  server.delete<{ Params: { centerId: string; roomId: string } }>("/centers/:centerId/rooms/:roomId", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const center = await prisma.center.findFirst({ where: { id: request.params.centerId, tenantId: request.ctx.tenantId } });
      if (!center) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      // La relación cita→sala es Restrict: con citas asociadas el borrado fallaría en
      // BD. La de visitas es SetNull (no bloquea), así que un walk-in en curso podría
      // colarse: se comprueban ambas y se da un mensaje claro orientando a desactivar.
      const [apptCount, visitCount] = await Promise.all([
        prisma.appointment.count({ where: { roomId: request.params.roomId } }),
        prisma.visit.count({ where: { currentRoomId: request.params.roomId, status: "IN_PROGRESS" } }),
      ]);
      if (apptCount > 0 || visitCount > 0) {
        const parts = [apptCount > 0 ? `${apptCount} cita(s)` : null, visitCount > 0 ? `${visitCount} paciente(s) en curso` : null].filter(Boolean).join(" y ");
        return reply.status(409).send({ errors: [{ code: "ROOM_IN_USE", message: `Esta sala tiene ${parts} y no se puede eliminar. Desactívala en su lugar para conservar el historial.` }] });
      }
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
