import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { auditLog } from "../lib/audit.js";

const createAppointmentSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  roomId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  source: z.enum(["BACKOFFICE", "WALK_IN", "API"]).default("BACKOFFICE"),
  notes: z.string().optional(),
  doctorId: z.string().uuid().optional(),
});

const updateAppointmentSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]).optional(),
  notes: z.string().optional(),
  doctorId: z.string().uuid().optional(),
});

const slotsQuerySchema = z.object({
  roomId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]).optional(),
  date: z.string().optional(),
  customerId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
});

type RoomSchedule = {
  openTime?: string;
  closeTime?: string;
  activeDays?: number[];
  slotDuration?: number;
  slotBuffer?: number;
};

export async function appointmentRoutes(server: FastifyInstance) {
  // GET /appointments/slots — available slots
  server.get("/appointments/slots", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = slotsQuerySchema.safeParse(request.query);
      if (!query.success) return reply.status(400).send({ errors: query.error.flatten().fieldErrors });

      const { roomId, date, productId } = query.data;

      const room = await prisma.room.findFirst({
        where: { id: roomId, center: { tenantId: request.ctx.tenantId } },
      });
      if (!room) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const roomSchedule = (room.schedule as RoomSchedule | null) ?? {};

      let slotDuration = roomSchedule.slotDuration;
      if (productId) {
        const product = await prisma.product.findFirst({ where: { id: productId, tenantId: request.ctx.tenantId } });
        if (product) slotDuration = product.slotDuration;
      }

      const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId } });
      slotDuration = slotDuration ?? config?.defaultSlotDuration ?? 20;
      const slotBuffer = roomSchedule.slotBuffer ?? 0;

      const openTime = roomSchedule.openTime ?? "08:00";
      const closeTime = roomSchedule.closeTime ?? "20:00";
      const [openH = 8, openM = 0] = openTime.split(":").map(Number);
      const [closeH = 20, closeM = 0] = closeTime.split(":").map(Number);

      const dateObj = new Date(`${date}T00:00:00`);
      const dayOfWeek = dateObj.getDay();
      const activeDays = roomSchedule.activeDays;
      if (activeDays && !activeDays.includes(dayOfWeek)) {
        return reply.send({ data: [], errors: null });
      }

      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);

      const existing = await prisma.appointment.findMany({
        where: { roomId, scheduledAt: { gte: dayStart, lte: dayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        select: { scheduledAt: true, durationMinutes: true },
      });

      const bookedSlots = existing.map((a) => ({
        start: a.scheduledAt.getTime(),
        end: a.scheduledAt.getTime() + a.durationMinutes * 60_000,
      }));

      const slots: string[] = [];
      const totalMinutes = closeH * 60 + closeM - (openH * 60 + openM);
      const stepMinutes = slotDuration + slotBuffer;
      const numSlots = Math.floor(totalMinutes / stepMinutes);

      for (let i = 0; i < numSlots; i++) {
        const slotMinutes = openH * 60 + openM + i * stepMinutes;
        const slotH = Math.floor(slotMinutes / 60);
        const slotM = slotMinutes % 60;
        const slotTime = new Date(`${date}T${String(slotH).padStart(2, "0")}:${String(slotM).padStart(2, "0")}:00.000Z`);
        const slotEnd = slotTime.getTime() + slotDuration * 60_000;
        const isBooked = bookedSlots.some((b) => slotTime.getTime() < b.end && slotEnd > b.start);
        if (!isBooked) slots.push(slotTime.toISOString());
      }

      return reply.send({ data: slots, errors: null });
    });

  // GET /appointments
  server.get("/appointments", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;
      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId };
      if (query.status) where["status"] = query.status;
      if (query.customerId) where["customerId"] = query.customerId;
      if (query.roomId) where["roomId"] = query.roomId;
      if (query.date) {
        const d = new Date(`${query.date}T00:00:00.000Z`);
        where["scheduledAt"] = { gte: d, lte: new Date(d.getTime() + 86_400_000) };
      }
      const [appointments, total] = await Promise.all([
        prisma.appointment.findMany({
          where,
          skip,
          take: query.limit,
          include: {
            customer: { select: { id: true, firstName: true, lastName: true } },
            product: { select: { id: true, name: true } },
            room: { include: { center: { select: { id: true, name: true } } } },
          },
          orderBy: { scheduledAt: "asc" },
        }),
        prisma.appointment.count({ where }),
      ]);
      return reply.send({ data: appointments, meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) }, errors: null });
    });

  // POST /appointments
  server.post("/appointments", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createAppointmentSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const [customer, product, room] = await Promise.all([
        prisma.customer.findFirst({ where: { id: body.data.customerId, tenantId: request.ctx.tenantId, deletedAt: null } }),
        prisma.product.findFirst({ where: { id: body.data.productId, tenantId: request.ctx.tenantId, active: true } }),
        prisma.room.findFirst({ where: { id: body.data.roomId, center: { tenantId: request.ctx.tenantId } } }),
      ]);
      if (!customer) return reply.status(400).send({ errors: [{ code: "INVALID_CUSTOMER" }] });
      if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });
      if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });

      try {
        const appointment = await prisma.appointment.create({
          data: {
            tenantId: request.ctx.tenantId,
            customerId: body.data.customerId,
            productId: body.data.productId,
            roomId: body.data.roomId,
            scheduledAt: new Date(body.data.scheduledAt),
            durationMinutes: product.slotDuration,
            source: body.data.source,
            notes: body.data.notes ?? null,
            status: "PENDING",
            doctorId: body.data.doctorId ?? null,
            createdById: request.ctx.userId,
          },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true } },
            product: { select: { id: true, name: true } },
            room: { include: { center: true } },
          },
        });

        await auditLog(
          { tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip },
          "CREATE",
          "appointment",
          appointment.id,
          { after: { id: appointment.id, scheduledAt: appointment.scheduledAt, status: appointment.status } },
        );

        return reply.status(201).send({ data: appointment, errors: null });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique constraint")) {
          return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada" }] });
        }
        throw err;
      }
    });

  // GET /appointments/:id
  server.get<{ Params: { id: string } }>("/appointments/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const appointment = await prisma.appointment.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        include: { customer: true, product: true, room: { include: { center: true } }, revision: true },
      });
      if (!appointment) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: appointment, errors: null });
    });

  // PATCH /appointments/:id
  server.patch<{ Params: { id: string } }>("/appointments/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const body = updateAppointmentSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.appointment.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const updateData: Record<string, unknown> = {};
      if (body.data.status !== undefined) updateData["status"] = body.data.status;
      if (body.data.scheduledAt !== undefined) updateData["scheduledAt"] = new Date(body.data.scheduledAt);
      if (body.data.notes !== undefined) updateData["notes"] = body.data.notes;
      if (body.data.doctorId !== undefined) updateData["doctorId"] = body.data.doctorId;

      const updated = await prisma.appointment.update({ where: { id: request.params.id }, data: updateData });

      await auditLog(
        { tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip },
        "UPDATE",
        "appointment",
        updated.id,
        { before: { status: existing.status }, after: { status: updated.status } },
      );

      return reply.send({ data: updated, errors: null });
    });
}
