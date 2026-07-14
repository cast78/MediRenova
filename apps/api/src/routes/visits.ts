import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireAnyRole, ROLES_STAFF, ROLES_DOCTOR } from "../lib/authorization.js";
import { auditLog } from "../lib/audit.js";
import { nowInTimezone } from "../lib/availability.js";

// Check-in: desde una reserva (appointmentId) o walk-in (customerId + centerId).
const checkinSchema = z
  .object({
    appointmentId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    centerId: z.string().uuid().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => Boolean(d.appointmentId) || Boolean(d.customerId && d.centerId), {
    message: "Indica appointmentId (desde reserva) o customerId + centerId (walk-in)",
  });

const boardQuerySchema = z.object({
  centerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const utilizationQuerySchema = z.object({
  centerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Horas de los slots que oferta una sala ese día de la semana (schedule.slotsByDay).
function offeredTimesFor(schedule: unknown, dow: number): string[] {
  const sb = (schedule as { slotsByDay?: Record<string, string[]> } | null)?.slotsByDay;
  const day = sb?.[String(dow)];
  return Array.isArray(day) ? day.filter((t) => /^\d{2}:\d{2}$/.test(t)) : [];
}
// Una cita "ocupa" un hueco salvo que esté anulada o reprogramada.
const occupiesSlot = (status: string) => status !== "CANCELLED" && status !== "RESCHEDULED";

const updateVisitSchema = z.object({
  status: z.enum(["WAITING", "IN_PROGRESS", "COMPLETED", "LEFT", "CANCELLED"]).optional(),
  currentRoomId: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
});

// Transiciones válidas del episodio físico. COMPLETED es terminal; LEFT/CANCELLED
// solo permiten volver a WAITING (reactivar si llegó de nuevo / se corrige un error).
const VISIT_TRANSITIONS: Record<string, string[]> = {
  WAITING: ["IN_PROGRESS", "LEFT", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "WAITING"],
  COMPLETED: [],
  LEFT: ["WAITING"],
  CANCELLED: ["WAITING"],
};

// Rango UTC [inicio, fin) del día natural `date` en la zona horaria `tz`. arrivedAt
// se guarda como instante real (CURRENT_TIMESTAMP), así que el "hoy" del tablero se
// calcula en la zona del centro. El offset se toma al mediodía (evita el borde DST).
function localDayRangeUtc(date: string, tz: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(noonUtc);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  const offset = asUtc - noonUtc.getTime(); // ms que la zona va por delante de UTC
  const start = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0) - offset);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

const visitInclude = {
  customer: { select: { id: true, firstName: true, lastName: true } },
  currentRoom: { select: { id: true, name: true } },
  appointment: {
    select: { id: true, scheduledAt: true, durationMinutes: true, status: true, product: { select: { id: true, name: true } }, room: { select: { id: true, name: true } } },
  },
  revision: { select: { id: true, outcome: true } },
} as const;

export async function visitRoutes(server: FastifyInstance) {
  // GET /visits/board?centerId&date — feed del tablero de actividad por sala
  server.get("/visits/board", { preHandler: [requireAnyRole(ROLES_STAFF)] }, async (request, reply) => {
    const q = boardQuerySchema.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });

    const center = await prisma.center.findFirst({
      where: { id: q.data.centerId, tenantId: request.ctx.tenantId },
      select: { id: true, name: true },
    });
    if (!center) return reply.status(404).send({ errors: [{ code: "CENTER_NOT_FOUND" }] });

    const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId }, select: { timezone: true, waitAmberMinutes: true, waitRedMinutes: true } });
    const tz = config?.timezone ?? "Europe/Madrid";
    const waitThresholds = { amber: config?.waitAmberMinutes ?? 10, red: config?.waitRedMinutes ?? 20 };
    const date = q.data.date ?? nowInTimezone(tz).date;
    const { start, end } = localDayRangeUtc(date, tz);

    const [rooms, visits] = await Promise.all([
      prisma.room.findMany({ where: { centerId: center.id, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.visit.findMany({
        where: { tenantId: request.ctx.tenantId, centerId: center.id, arrivedAt: { gte: start, lt: end } },
        include: visitInclude,
        orderBy: { arrivedAt: "asc" },
      }),
    ]);

    const waiting = visits.filter((v) => v.status === "WAITING");
    const now = Date.now();
    const avgWaitMinutes = waiting.length
      ? Math.round(waiting.reduce((a, v) => a + (now - v.arrivedAt.getTime()), 0) / waiting.length / 60_000)
      : 0;
    const kpis = {
      waiting: waiting.length,
      inProgress: visits.filter((v) => v.status === "IN_PROGRESS").length,
      completedToday: visits.filter((v) => v.status === "COMPLETED").length,
      avgWaitMinutes,
    };

    return reply.send({ data: { center, date, rooms, visits, kpis, waitThresholds }, errors: null });
  });

  // GET /visits/consulta?centerId&date — lista de trabajo del MÉDICO. Parte de las
  // citas del día del centro (no solo de quien ha hecho check-in) y les cruza el
  // estado de visita y revisión, para que el médico vea de un vistazo qué tiene que
  // atender ahora, qué está en curso, qué viene y qué ha cerrado. `mine` marca las
  // que son suyas (su sala asignada o cita asignada a él); el front filtra por eso.
  server.get("/visits/consulta", { preHandler: [requireAnyRole(ROLES_DOCTOR)] }, async (request, reply) => {
    const q = boardQuerySchema.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });

    const center = await prisma.center.findFirst({
      where: { id: q.data.centerId, tenantId: request.ctx.tenantId },
      select: { id: true, name: true },
    });
    if (!center) return reply.status(404).send({ errors: [{ code: "CENTER_NOT_FOUND" }] });

    const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId }, select: { timezone: true } });
    const tz = config?.timezone ?? "Europe/Madrid";
    const date = q.data.date ?? nowInTimezone(tz).date;
    // Las citas usan la convención "naïve" (scheduledAt = hora de pared etiquetada UTC),
    // así que el día se acota con ese mismo etiquetado, no con el rango real del tablero.
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const [rooms, myRooms, appts] = await Promise.all([
      prisma.room.findMany({ where: { centerId: center.id, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.roomDoctor.findMany({ where: { userId: request.ctx.userId, room: { centerId: center.id } }, select: { roomId: true } }),
      prisma.appointment.findMany({
        where: {
          tenantId: request.ctx.tenantId,
          room: { centerId: center.id },
          scheduledAt: { gte: dayStart, lte: dayEnd },
          status: { notIn: ["CANCELLED", "RESCHEDULED", "NO_SHOW"] },
        },
        select: {
          id: true, scheduledAt: true, status: true, doctorId: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
          product: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
          visit: { select: { id: true, status: true, arrivedAt: true, currentRoom: { select: { id: true, name: true } } } },
          revision: { select: { id: true, outcome: true } },
        },
        orderBy: { scheduledAt: "asc" },
      }),
    ]);

    const myRoomIds = myRooms.map((r) => r.roomId);
    const done = (rev: { outcome: string } | null, apptStatus: string, visitStatus?: string) =>
      apptStatus === "ATTENDED" || visitStatus === "COMPLETED" || (!!rev && (rev.outcome === "APTO" || rev.outcome === "NO_APTO"));

    const items = appts.map((a) => {
      let state: "upcoming" | "ready" | "in_progress" | "done";
      if (done(a.revision, a.status, a.visit?.status)) state = "done";
      else if (a.revision) state = "in_progress"; // revisión abierta (PENDING)
      else if (a.visit) state = "ready"; // ha llegado, sin revisión aún
      else state = "upcoming"; // reservado, aún no llega
      const mine = (!!a.room && myRoomIds.includes(a.room.id)) || a.doctorId === request.ctx.userId;
      return { ...a, state, mine };
    });

    return reply.send({ data: { center, date, rooms, myRoomIds, items }, errors: null });
  });

  // GET /visits/utilization?centerId&date — visor de utilización por sala de un día
  // concreto (pasado o futuro). Reservas del día por sala + ocupación real (usando
  // los slots que oferta cada sala ese día) + KPIs. Solo lectura, para el back office.
  server.get("/visits/utilization", { preHandler: [requireAnyRole(ROLES_STAFF)] }, async (request, reply) => {
    const q = utilizationQuerySchema.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });

    if (request.ctx.centerId && q.data.centerId !== request.ctx.centerId) {
      return reply.status(403).send({ errors: [{ code: "CENTER_FORBIDDEN" }] });
    }
    const center = await prisma.center.findFirst({ where: { id: q.data.centerId, tenantId: request.ctx.tenantId }, select: { id: true, name: true } });
    if (!center) return reply.status(404).send({ errors: [{ code: "CENTER_NOT_FOUND" }] });

    // Rango del día en convenio naïve (mismas horas de pared que scheduledAt).
    const dayStart = new Date(`${q.data.date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const dow = new Date(`${q.data.date}T00:00:00`).getDay(); // 0=Dom … 6=Sáb

    const [rooms, appts] = await Promise.all([
      prisma.room.findMany({ where: { centerId: center.id, active: true }, select: { id: true, name: true, schedule: true }, orderBy: { name: "asc" } }),
      prisma.appointment.findMany({
        where: { tenantId: request.ctx.tenantId, room: { centerId: center.id }, scheduledAt: { gte: dayStart, lt: dayEnd } },
        select: {
          id: true, scheduledAt: true, durationMinutes: true, status: true, roomId: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
          product: { select: { id: true, name: true } },
          visit: { select: { id: true, status: true, arrivedAt: true, startedAt: true, completedAt: true } },
          revision: { select: { id: true, outcome: true } },
        },
        orderBy: { scheduledAt: "asc" },
      }),
    ]);

    const roomsOut = rooms.map((r) => {
      const roomAppts = appts.filter((a) => a.roomId === r.id);
      const offeredTimes = offeredTimesFor(r.schedule, dow);
      const offeredSlots = offeredTimes.length;
      const bookedSlots = roomAppts.filter((a) => occupiesSlot(a.status)).length;
      const occupancy = offeredSlots > 0 ? Math.min(1, bookedSlots / offeredSlots) : null;
      return { id: r.id, name: r.name, offeredTimes, offeredSlots, bookedSlots, occupancy, appointments: roomAppts };
    });

    const totalOffered = roomsOut.reduce((n, r) => n + r.offeredSlots, 0);
    const totalBooked = roomsOut.reduce((n, r) => n + r.bookedSlots, 0);
    const durations = appts
      .filter((a) => a.visit?.startedAt && a.visit?.completedAt)
      .map((a) => (new Date(a.visit!.completedAt!).getTime() - new Date(a.visit!.startedAt!).getTime()) / 60_000);

    const kpis = {
      occupancy: totalOffered > 0 ? Math.round((totalBooked / totalOffered) * 100) : null,
      reservas: appts.filter((a) => occupiesSlot(a.status)).length,
      atendidas: appts.filter((a) => a.status === "ATTENDED").length,
      noShow: appts.filter((a) => a.status === "NO_SHOW").length,
      avgRoomMinutes: durations.length ? Math.round(durations.reduce((x, y) => x + y, 0) / durations.length) : null,
      freeSlots: Math.max(0, totalOffered - totalBooked),
    };

    return reply.send({ data: { center, date: q.data.date, rooms: roomsOut, kpis }, errors: null });
  });

  // POST /visits — check-in (desde reserva o walk-in). Crea el episodio en WAITING.
  server.post("/visits", { preHandler: [requireRole("RECEPTIONIST")] }, async (request, reply) => {
    const body = checkinSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

    let customerId: string;
    let centerId: string;
    let appointmentId: string | null = null;

    if (body.data.appointmentId) {
      const appt = await prisma.appointment.findFirst({
        where: { id: body.data.appointmentId, tenantId: request.ctx.tenantId },
        include: { room: { select: { centerId: true } }, visit: { select: { id: true } } },
      });
      if (!appt) return reply.status(404).send({ errors: [{ code: "APPOINTMENT_NOT_FOUND" }] });
      if (appt.visit) return reply.status(409).send({ errors: [{ code: "ALREADY_CHECKED_IN", message: "Esta reserva ya tiene una visita" }] });
      if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
        return reply.status(400).send({ errors: [{ code: "APPOINTMENT_NOT_ACTIVE", message: "La reserva no está activa" }] });
      }
      appointmentId = appt.id;
      customerId = appt.customerId;
      centerId = appt.room.centerId;
    } else {
      const [customer, center] = await Promise.all([
        prisma.customer.findFirst({ where: { id: body.data.customerId!, tenantId: request.ctx.tenantId, deletedAt: null }, select: { id: true } }),
        prisma.center.findFirst({ where: { id: body.data.centerId!, tenantId: request.ctx.tenantId }, select: { id: true } }),
      ]);
      if (!customer) return reply.status(400).send({ errors: [{ code: "INVALID_CUSTOMER" }] });
      if (!center) return reply.status(400).send({ errors: [{ code: "INVALID_CENTER" }] });
      customerId = customer.id;
      centerId = center.id;
    }

    const visit = await prisma.visit.create({
      data: {
        tenantId: request.ctx.tenantId,
        centerId,
        customerId,
        appointmentId,
        status: "WAITING",
        notes: body.data.notes ?? null,
        createdById: request.ctx.userId,
      },
      include: visitInclude,
    });

    await auditLog(
      { tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip },
      "CREATE", "visit", visit.id, { after: { id: visit.id, status: visit.status, appointmentId } },
    );

    return reply.status(201).send({ data: visit, errors: null });
  });

  // PATCH /visits/:id — llamar a sala, cambiar de sala, cerrar o marcar que se fue.
  server.patch<{ Params: { id: string } }>("/visits/:id", { preHandler: [requireRole("RECEPTIONIST")] }, async (request, reply) => {
    const body = updateVisitSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

    const existing = await prisma.visit.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
    if (!existing) return reply.status(404).send({ errors: [{ code: "VISIT_NOT_FOUND" }] });

    const data: Record<string, unknown> = {};
    if (body.data.notes !== undefined) data.notes = body.data.notes;

    if (body.data.currentRoomId !== undefined) {
      if (body.data.currentRoomId) {
        const room = await prisma.room.findFirst({ where: { id: body.data.currentRoomId, centerId: existing.centerId }, select: { id: true } });
        if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM", message: "La sala no pertenece al centro de la visita" }] });
      }
      data.currentRoomId = body.data.currentRoomId;
    }

    if (body.data.status && body.data.status !== existing.status) {
      const allowed = VISIT_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(body.data.status)) {
        return reply.status(400).send({ errors: [{ code: "INVALID_TRANSITION", message: `No se puede pasar de ${existing.status} a ${body.data.status}` }] });
      }
      data.status = body.data.status;
      const now = new Date();
      if (body.data.status === "IN_PROGRESS") {
        if (!existing.calledAt) data.calledAt = now;
        if (!existing.startedAt) data.startedAt = now;
      }
      if (body.data.status === "COMPLETED" && !existing.completedAt) data.completedAt = now;
    }

    const visit = await prisma.visit.update({ where: { id: existing.id }, data, include: visitInclude });

    await auditLog(
      { tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip },
      "UPDATE", "visit", visit.id, { after: { status: visit.status, currentRoomId: visit.currentRoomId } },
    );

    // "Se fue" (LEFT): el paciente llegó pero se marchó → la reserva se cierra como
    // No presentó (así sale de "Sin cerrar" y cuenta en métricas). El matiz "se fue"
    // queda en la visita (LEFT), que el ciclo/timeline muestran como "Se fue".
    if (body.data.status === "LEFT" && existing.appointmentId) {
      await prisma.appointment.updateMany({
        where: { id: existing.appointmentId, tenantId: request.ctx.tenantId, status: { in: ["PENDING", "CONFIRMED"] } },
        data: { status: "NO_SHOW" },
      }).catch(() => {});
    }

    return reply.send({ data: visit, errors: null });
  });
}
