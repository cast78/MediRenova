import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { auditLog } from "../lib/audit.js";
import { markWorkflowConverted } from "../lib/workflow-cron.js";
import { buildIcs } from "../lib/ics.js";
import { computeDaySlots, productAllowedInRoom, nowInTimezone } from "../lib/availability.js";
import { roomHasOverlap } from "../lib/booking.js";
import { signConfirmationToken } from "../lib/jwt.js";
import { appointmentEvents } from "../lib/appointment-timeline.js";

const PUBLIC_URL = process.env["PUBLIC_URL"] ?? "http://localhost:3000";

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
  // ATTENDED no es asignable por el usuario: lo fija el sistema al completar la revisión.
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]).optional(),
  cancelReason: z.enum(["CLIENTE", "CENTRO", "DUPLICADA", "ERROR", "OTRO"]).optional(),
  notes: z.string().optional(),
  doctorId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(), // reprogramar a otra sala
});

// Transiciones de estado válidas (gestión de la cita). ATTENDED es terminal y lo
// fija el sistema; los estados terminales solo permiten reactivar a CONFIRMED.
// PENDING puede cerrarse como NO_SHOW (limbo: pasó su hora sin confirmar ni venir).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CANCELLED", "NO_SHOW"],
  NO_SHOW: ["CONFIRMED"],
  CANCELLED: ["CONFIRMED"],
  ATTENDED: [],
  RESCHEDULED: ["CONFIRMED"],
};

const slotsQuerySchema = z.object({
  roomId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20), // 500 para rangos semana/mes
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]).optional(),
  date: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // rango (vista semana/mes)
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customerId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
});

type RoomSchedule = {
  slotsByDay?: Record<string, string[]>;
};

export async function appointmentRoutes(server: FastifyInstance) {
  // GET /appointments/slots — available slots
  server.get("/appointments/slots", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = slotsQuerySchema.safeParse(request.query);
      if (!query.success) return reply.status(400).send({ errors: query.error.flatten().fieldErrors });

      const { roomId, date, productId } = query.data;

      const room = await prisma.room.findFirst({
        where: { id: roomId, center: { tenantId: request.ctx.tenantId }, ...(request.ctx.centerId ? { centerId: request.ctx.centerId } : {}) },
        include: { center: { select: { holidays: true } } },
      });
      if (!room) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const roomSchedule = (room.schedule as RoomSchedule | null) ?? {};
      const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId } });
      // La duración la marca el producto; la granularidad de huecos, la config.
      let slotDuration = config?.defaultSlotDuration ?? 20;
      if (productId) {
        // Si el producto no se ofrece en esta sala, no hay disponibilidad.
        if (!productAllowedInRoom(room.allowedProductIds, productId)) {
          return reply.send({ data: [], errors: null });
        }
        const product = await prisma.product.findFirst({ where: { id: productId, tenantId: request.ctx.tenantId } });
        if (product) slotDuration = product.slotDuration;
      }
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);
      const existing = await prisma.appointment.findMany({
        where: { roomId, scheduledAt: { gte: dayStart, lte: dayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW", "RESCHEDULED"] } },
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
      });

      return reply.send({ data: slots, errors: null });
    });

  // GET /appointments/:id/ics — archivo iCalendar de la reserva (RFC 5545)
  server.get<{ Params: { id: string } }>("/appointments/:id/ics", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const appt = await prisma.appointment.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        include: {
          product: { select: { name: true } },
          customer: { select: { firstName: true, lastName: true } },
          room: { include: { center: true } },
        },
      });
      if (!appt) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (request.ctx.centerId && appt.room.centerId !== request.ctx.centerId) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const center = appt.room.center;
      const ics = buildIcs({
        uid: `appointment-${appt.id}@medirenova`,
        start: appt.scheduledAt,
        durationMinutes: appt.durationMinutes,
        dtstamp: new Date(),
        summary: `Cita: ${appt.product.name}`,
        description: `Reconocimiento médico — ${[appt.customer.firstName, appt.customer.lastName].filter(Boolean).join(" ")}`,
        location: `${center.name}, ${center.address}, ${center.city} (${center.province})`,
      });
      return reply
        .header("Content-Type", "text/calendar; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="cita-${appt.id}.ics"`)
        .send(ics);
    });

  // GET /appointments
  server.get("/appointments", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;
      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId };
      if (request.ctx.centerId) where["room"] = { centerId: request.ctx.centerId };
      if (query.status) where["status"] = query.status;
      if (query.customerId) where["customerId"] = query.customerId;
      if (query.roomId) where["roomId"] = query.roomId;
      if (query.from || query.to) {
        const range: Record<string, Date> = {};
        if (query.from) range["gte"] = new Date(`${query.from}T00:00:00.000Z`);
        if (query.to) range["lte"] = new Date(`${query.to}T23:59:59.999Z`);
        where["scheduledAt"] = range;
      } else if (query.date) {
        const d = new Date(`${query.date}T00:00:00.000Z`);
        where["scheduledAt"] = { gte: d, lte: new Date(d.getTime() + 86_400_000) };
      }
      const [appointments, total] = await Promise.all([
        prisma.appointment.findMany({
          where,
          skip,
          take: query.limit,
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
            product: { select: { id: true, name: true } },
            room: { include: { center: { select: { id: true, name: true } } } },
            visit: { select: { id: true, status: true, centerId: true, arrivedAt: true, startedAt: true, completedAt: true } },
            revision: { select: { id: true, outcome: true } },
            rescheduledTo: { select: { id: true, scheduledAt: true } },
            rescheduledFrom: { select: { id: true, scheduledAt: true } },
          },
          orderBy: { scheduledAt: "asc" },
        }),
        prisma.appointment.count({ where }),
      ]);
      return reply.send({ data: appointments, meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) }, errors: null });
    });

  // GET /appointments/unclosed — citas "sin cerrar": de días pasados y aún en
  // PENDING/CONFIRMED (nadie las cerró como atendida/no-show/cancelada). Worklist
  // de higiene para recepción; sin ellas, el KPI de no-show queda infravalorado.
  server.get("/appointments/unclosed", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }).safeParse(request.query);
      if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });
      const { page, limit } = q.data;

      // Inicio del día de hoy en convenio naïve (hora de pared del centro).
      const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId }, select: { timezone: true } });
      const today = nowInTimezone(config?.timezone ?? "Europe/Madrid").date;
      const todayStart = new Date(`${today}T00:00:00.000Z`);

      const where: Record<string, unknown> = {
        tenantId: request.ctx.tenantId,
        status: { in: ["PENDING", "CONFIRMED"] },
        scheduledAt: { lt: todayStart },
      };
      if (request.ctx.centerId) where["room"] = { centerId: request.ctx.centerId };

      const [appointments, total] = await Promise.all([
        prisma.appointment.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
            product: { select: { id: true, name: true } },
            room: { include: { center: { select: { id: true, name: true } } } },
            visit: { select: { id: true, status: true, centerId: true, arrivedAt: true, startedAt: true, completedAt: true } },
            revision: { select: { id: true, outcome: true } },
          },
          orderBy: { scheduledAt: "desc" },
        }),
        prisma.appointment.count({ where }),
      ]);
      return reply.send({ data: appointments, meta: { page, limit, total, pages: Math.ceil(total / limit) }, errors: null });
    });

  // POST /appointments
  server.post("/appointments", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createAppointmentSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const [customer, product, room] = await Promise.all([
        prisma.customer.findFirst({ where: { id: body.data.customerId, tenantId: request.ctx.tenantId, deletedAt: null } }),
        prisma.product.findFirst({ where: { id: body.data.productId, tenantId: request.ctx.tenantId, active: true } }),
        prisma.room.findFirst({ where: { id: body.data.roomId, center: { tenantId: request.ctx.tenantId }, ...(request.ctx.centerId ? { centerId: request.ctx.centerId } : {}) } }),
      ]);
      if (!customer) return reply.status(400).send({ errors: [{ code: "INVALID_CUSTOMER" }] });
      if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });
      if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });

      if (!productAllowedInRoom(room.allowedProductIds, body.data.productId)) {
        return reply.status(400).send({ errors: [{ code: "PRODUCT_NOT_ALLOWED_IN_ROOM", message: "Este producto no se ofrece en la sala seleccionada" }] });
      }
      // No se puede reservar en el pasado (misma regla que reprogramar). El walk-in
      // se exceptúa: su hora ES "ahora" por definición (el paciente ya está presente).
      if (body.data.source !== "WALK_IN") {
        const cfg = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId }, select: { timezone: true } });
        const now = nowInTimezone(cfg?.timezone ?? "Europe/Madrid");
        const at = body.data.scheduledAt;
        const atMin = Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
        if (at.slice(0, 10) < now.date || (at.slice(0, 10) === now.date && atMin <= now.minutes)) {
          return reply.status(400).send({ errors: [{ code: "APPOINTMENT_IN_PAST", message: "El horario debe ser posterior a ahora." }] });
        }
      }
      // Anti-solape estricto: una sala solo atiende a un paciente a la vez, sin
      // excepción (no hay forma de forzarlo).
      if (await roomHasOverlap(body.data.roomId, new Date(body.data.scheduledAt), product.slotDuration)) {
        return reply.status(409).send({ errors: [{ code: "ROOM_OCCUPIED", message: "La sala ya tiene una cita en ese horario. Elige otro hueco." }] });
      }

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
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
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

        // 12.7: la reserva detiene los avisos de renovación pendientes del cliente
        await markWorkflowConverted(request.ctx.tenantId, body.data.customerId, body.data.productId).catch((err) => {
          request.log.error(err, "[workflow] markWorkflowConverted failed");
        });

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
        include: { customer: true, product: true, room: { include: { center: true } }, revision: true, visit: { select: { id: true, status: true, centerId: true } }, rescheduledTo: { select: { id: true, scheduledAt: true } }, rescheduledFrom: { select: { id: true, scheduledAt: true } } },
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

      // Validación de transición de estado.
      if (body.data.status !== undefined && body.data.status !== existing.status) {
        const allowed = STATUS_TRANSITIONS[existing.status] ?? [];
        if (!allowed.includes(body.data.status)) {
          return reply.status(400).send({ errors: [{ code: "INVALID_TRANSITION", message: `No se puede pasar de ${existing.status} a ${body.data.status}` }] });
        }
      }
      // Reprogramar (cambiar fecha/sala) solo si la cita está activa.
      if ((body.data.scheduledAt !== undefined || body.data.roomId !== undefined) && !["PENDING", "CONFIRMED"].includes(existing.status)) {
        return reply.status(400).send({ errors: [{ code: "CANNOT_RESCHEDULE", message: "Solo se pueden reprogramar citas pendientes o confirmadas" }] });
      }

      // No se puede reprogramar al pasado: el nuevo hueco debe ser posterior a
      // "ahora" (hora de pared del centro), coherente con el filtrado de huecos.
      if (body.data.scheduledAt !== undefined) {
        const cfg = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId }, select: { timezone: true } });
        const now = nowInTimezone(cfg?.timezone ?? "Europe/Madrid");
        const at = body.data.scheduledAt;
        const atMin = Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
        if (at.slice(0, 10) < now.date || (at.slice(0, 10) === now.date && atMin <= now.minutes)) {
          return reply.status(400).send({ errors: [{ code: "RESCHEDULE_IN_PAST", message: "El nuevo horario debe ser posterior a ahora." }] });
        }
      }

      // Anti-solape también en modificación (no solo al crear): una sala solo
      // atiende a un paciente a la vez, sin excepción. Se comprueba si la cita va a
      // OCUPAR hueco y (cambia de fecha/sala, o pasa a ocupar desde no-ocupar, p.ej.
      // reactivar una cancelada cuyo hueco lo tomó otra en el interín).
      const finalStatus = body.data.status ?? existing.status;
      const willOccupy = finalStatus !== "CANCELLED" && finalStatus !== "NO_SHOW";
      const wasOccupying = existing.status !== "CANCELLED" && existing.status !== "NO_SHOW";
      const slotChanged = body.data.scheduledAt !== undefined || body.data.roomId !== undefined;
      if (willOccupy && (slotChanged || !wasOccupying)) {
        const finalRoomId = body.data.roomId ?? existing.roomId;
        const finalAt = body.data.scheduledAt ? new Date(body.data.scheduledAt) : existing.scheduledAt;
        if (await roomHasOverlap(finalRoomId, finalAt, existing.durationMinutes, existing.id)) {
          return reply.status(409).send({ errors: [{ code: "ROOM_OCCUPIED", message: "La sala ya tiene una cita en ese horario. Elige otro hueco." }] });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (body.data.status !== undefined) updateData["status"] = body.data.status;
      if (body.data.scheduledAt !== undefined) updateData["scheduledAt"] = new Date(body.data.scheduledAt);
      if (body.data.notes !== undefined) updateData["notes"] = body.data.notes;
      if (body.data.doctorId !== undefined) updateData["doctorId"] = body.data.doctorId;
      if (body.data.roomId !== undefined) updateData["roomId"] = body.data.roomId;
      // Motivo de cancelación: se guarda al cancelar; se limpia al salir de CANCELLED.
      if (body.data.status === "CANCELLED") updateData["cancelReason"] = body.data.cancelReason ?? null;
      else if (body.data.status !== undefined && existing.status === "CANCELLED") updateData["cancelReason"] = null;

      const updated = await prisma.appointment.update({ where: { id: request.params.id }, data: updateData });

      await auditLog(
        { tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip },
        "UPDATE",
        "appointment",
        updated.id,
        { before: { status: existing.status }, after: { status: updated.status } },
      );

      // Historial del cliente: cancelación / no-show hechos por recepción (hora exacta
      // + actor). El cliente por enlace ya se registra en magic-link.ts.
      if (updated.status !== existing.status && (updated.status === "CANCELLED" || updated.status === "NO_SHOW")) {
        await prisma.customerEvent.create({ data: {
          tenantId: request.ctx.tenantId, customerId: existing.customerId, appointmentId: existing.id,
          type: updated.status === "CANCELLED" ? "cita_cancelada" : "no_show",
          actor: "recepcion", detail: updated.cancelReason ?? null,
        } }).catch(() => {});
      }

      return reply.send({ data: updated, errors: null });
    });

  // POST /appointments/:id/reschedule — reprogramar (modelo "fantasma"): la cita
  // vieja queda RESCHEDULED en su día (rastro visible) y se crea una NUEVA en el
  // nuevo hueco, enlazada por rescheduledFromId. El hueco viejo se libera.
  server.post<{ Params: { id: string } }>("/appointments/:id/reschedule", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const body = z.object({ scheduledAt: z.string().datetime(), roomId: z.string().uuid().optional() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.appointment.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (!["PENDING", "CONFIRMED"].includes(existing.status)) {
        return reply.status(400).send({ errors: [{ code: "CANNOT_RESCHEDULE", message: "Solo se pueden reprogramar citas pendientes o confirmadas" }] });
      }

      const targetRoomId = body.data.roomId ?? existing.roomId;
      const room = await prisma.room.findFirst({ where: { id: targetRoomId, center: { tenantId: request.ctx.tenantId }, ...(request.ctx.centerId ? { centerId: request.ctx.centerId } : {}) } });
      if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });
      if (!productAllowedInRoom(room.allowedProductIds, existing.productId)) {
        return reply.status(400).send({ errors: [{ code: "PRODUCT_NOT_ALLOWED_IN_ROOM", message: "Este producto no se ofrece en la sala seleccionada" }] });
      }

      // No al pasado (misma regla que crear/PATCH).
      const cfg = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId }, select: { timezone: true } });
      const now = nowInTimezone(cfg?.timezone ?? "Europe/Madrid");
      const at = body.data.scheduledAt;
      const atMin = Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
      if (at.slice(0, 10) < now.date || (at.slice(0, 10) === now.date && atMin <= now.minutes)) {
        return reply.status(400).send({ errors: [{ code: "RESCHEDULE_IN_PAST", message: "El nuevo horario debe ser posterior a ahora." }] });
      }

      // Anti-solape en el nuevo hueco (excluye la propia cita, que va a liberarse).
      if (await roomHasOverlap(targetRoomId, new Date(at), existing.durationMinutes, existing.id)) {
        return reply.status(409).send({ errors: [{ code: "ROOM_OCCUPIED", message: "La sala ya tiene una cita en ese horario. Elige otro hueco." }] });
      }

      const created = await prisma.$transaction(async (tx) => {
        const nueva = await tx.appointment.create({
          data: {
            tenantId: existing.tenantId,
            customerId: existing.customerId,
            productId: existing.productId,
            roomId: targetRoomId,
            doctorId: existing.doctorId,
            scheduledAt: new Date(at),
            durationMinutes: existing.durationMinutes,
            status: "CONFIRMED",
            source: existing.source,
            notes: existing.notes,
            createdById: request.ctx.userId,
            rescheduledFromId: existing.id,
          },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
            product: { select: { id: true, name: true } },
            room: { include: { center: { select: { id: true, name: true } } } },
            rescheduledFrom: { select: { id: true, scheduledAt: true } },
          },
        });
        // La cita vieja queda como fantasma en su día.
        await tx.appointment.update({ where: { id: existing.id }, data: { status: "RESCHEDULED" } });
        return nueva;
      });

      await auditLog(
        { tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip },
        "UPDATE", "appointment", existing.id,
        { reschedule: { from: existing.scheduledAt.toISOString(), to: created.scheduledAt.toISOString(), newId: created.id } },
      );

      return reply.status(201).send({ data: created, errors: null });
    });

  // POST /appointments/:id/confirmation-link — genera el enlace de confirmación para
  // enviarlo por WhatsApp/email. Devuelve la URL + contacto/consentimiento del cliente.
  server.post<{ Params: { id: string } }>("/appointments/:id/confirmation-link", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const appt = await prisma.appointment.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        include: {
          customer: { select: { firstName: true, lastName: true, phone: true, email: true, acceptsWhatsapp: true, acceptsEmail: true } },
          product: { select: { name: true } },
        },
      });
      if (!appt) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const token = signConfirmationToken({ cid: appt.customerId, pid: appt.productId, tid: appt.tenantId, aid: appt.id, type: "magic_link" });
      // Registra la acción en el historial del cliente (intención de solicitud).
      await prisma.customerEvent.create({ data: { tenantId: request.ctx.tenantId, customerId: appt.customerId, appointmentId: appt.id, type: "confirmacion_solicitada", actor: "recepcion" } }).catch(() => {});
      return reply.send({
        data: { url: `${PUBLIC_URL}/confirmar/${token}`, customer: appt.customer, product: appt.product, scheduledAt: appt.scheduledAt },
        errors: null,
      });
    });

  // GET /appointments/:id/timeline — trazabilidad de UNA cita (reserva → visita → revisión).
  server.get<{ Params: { id: string } }>("/appointments/:id/timeline", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const appt = await prisma.appointment.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        select: {
          id: true, scheduledAt: true, status: true, source: true, cancelReason: true, createdAt: true, updatedAt: true,
          product: { select: { name: true } },
          room: { select: { name: true } },
          visit: { select: { arrivedAt: true, calledAt: true, startedAt: true, status: true, updatedAt: true, currentRoom: { select: { name: true } } } },
          revision: { select: { outcome: true, completedAt: true, expiryDate: true, startedAt: true } },
        },
      });
      if (!appt) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const custEvents = await prisma.customerEvent.findMany({
        where: { appointmentId: appt.id, tenantId: request.ctx.tenantId },
        select: { type: true, channel: true, detail: true, createdAt: true, appointmentId: true },
      });
      const events = appointmentEvents(appt, custEvents);
      events.sort((x, y) => y.at.localeCompare(x.at));
      return reply.send({ data: events, errors: null });
    });
}
