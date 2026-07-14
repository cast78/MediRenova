import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";

export async function dashboardRoutes(server: FastifyInstance) {
  // GET /dashboard/summary — KPIs
  server.get("/dashboard/summary", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      // Centro efectivo: si el usuario está fijado a un centro (token) manda ese; si no
      // (admin/superadmin), el que venga del selector (?centerId). Vacío = todos.
      const qCenter = (request.query as { centerId?: string }).centerId;
      const cen = request.ctx.centerId ?? (qCenter || null);
      const apptScope = cen ? { room: { centerId: cen } } : {};
      const revScope = cen ? { appointment: { room: { centerId: cen } } } : {};
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const weekEnd = new Date(todayEnd); weekEnd.setDate(weekEnd.getDate() + 7);

      const [
        appointmentsToday,
        appointmentsWeek,
        openRevisions,
        completedThisMonth,
        totalThisMonth,
      ] = await Promise.all([
        prisma.appointment.count({ where: { tenantId: tid, ...apptScope, scheduledAt: { gte: todayStart, lte: todayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } } }),
        prisma.appointment.count({ where: { tenantId: tid, ...apptScope, scheduledAt: { gte: todayStart, lte: weekEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } } }),
        prisma.revision.count({ where: { tenantId: tid, ...revScope, outcome: "PENDING" } }),
        prisma.revision.count({ where: { tenantId: tid, ...revScope, outcome: { in: ["APTO", "NO_APTO"] }, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
        prisma.appointment.count({ where: { tenantId: tid, ...apptScope, scheduledAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) }, status: { notIn: ["CANCELLED"] } } }),
      ]);

      const conversionRate = totalThisMonth > 0 ? Math.round((completedThisMonth / totalThisMonth) * 100) : 0;

      return reply.send({
        data: { appointmentsToday, appointmentsWeek, openRevisions, conversionRate },
        errors: null,
      });
    });

  // GET /dashboard/communications — avisos/notificaciones a clientes este mes. Tenant-wide
  // (los eventos de comunicación no están ligados a un centro concreto).
  server.get("/dashboard/communications", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [manualSent, autoSent, responses] = await Promise.all([
        prisma.customerEvent.count({ where: { tenantId: tid, type: { in: ["recordatorio_renovacion", "confirmacion_solicitada"] }, createdAt: { gte: monthStart } } }),
        prisma.workflowExecution.count({ where: { rule: { tenantId: tid }, status: "SENT", lastAttemptAt: { gte: monthStart } } }),
        prisma.customerEvent.count({ where: { tenantId: tid, type: { in: ["cliente_confirmo", "cliente_cancelo"] }, createdAt: { gte: monthStart } } }),
      ]);
      const sent = manualSent + autoSent;
      const responseRate = sent > 0 ? Math.round((responses / sent) * 100) : null;
      return reply.send({ data: { sent, responses, responseRate }, errors: null });
    });

  // GET /dashboard/expirations — upcoming expirations
  server.get("/dashboard/expirations", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const qCenter = (request.query as { centerId?: string }).centerId;
      const cen = request.ctx.centerId ?? (qCenter || null);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const in90 = new Date(today); in90.setDate(in90.getDate() + 90);

      const expirations = await prisma.revision.findMany({
        where: { tenantId: tid, ...(cen ? { appointment: { room: { centerId: cen } } } : {}), expiryDate: { gte: today, lte: in90 }, outcome: "APTO" },
        include: {
          appointment: {
            include: {
              customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
              product: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { expiryDate: "asc" },
        take: 100,
      });

      // Check which customers have a future booking
      const customerIds = expirations.map((e) => e.customerId);
      const futureBookings = await prisma.appointment.findMany({
        where: {
          tenantId: tid,
          ...(cen ? { room: { centerId: cen } } : {}),
          customerId: { in: customerIds },
          scheduledAt: { gt: new Date() },
          status: { in: ["CONFIRMED", "PENDING"] },
        },
        select: { customerId: true },
      });
      const bookedCustomers = new Set(futureBookings.map((b) => b.customerId));

      const data = expirations.map((e) => ({
        revisionId: e.id,
        expiryDate: e.expiryDate,
        customer: e.appointment.customer,
        product: e.appointment.product,
        hasBooking: bookedCustomers.has(e.customerId),
        daysUntilExpiry: Math.ceil(((e.expiryDate?.getTime() ?? 0) - today.getTime()) / 86_400_000),
      }));

      return reply.send({ data, errors: null });
    });

  // GET /dashboard/expirations/summary — conteos por tramo para los KPIs de caducidades.
  // Devuelve los buckets (≤30 / 31–60 / 61–90) + total y cuántas caducan sin reserva
  // futura (el hueco accionable). No trae las filas, solo cuenta.
  server.get("/dashboard/expirations/summary", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const qCenter = (request.query as { centerId?: string }).centerId;
      const cen = request.ctx.centerId ?? (qCenter || null);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const in90 = new Date(today); in90.setDate(in90.getDate() + 90);

      const rows = await prisma.revision.findMany({
        where: { tenantId: tid, ...(cen ? { appointment: { room: { centerId: cen } } } : {}), expiryDate: { gte: today, lte: in90 }, outcome: "APTO" },
        select: { customerId: true, expiryDate: true },
      });

      const customerIds = [...new Set(rows.map((r) => r.customerId))];
      const futureBookings = customerIds.length
        ? await prisma.appointment.findMany({
            where: { tenantId: tid, ...(cen ? { room: { centerId: cen } } : {}), customerId: { in: customerIds }, scheduledAt: { gt: new Date() }, status: { in: ["CONFIRMED", "PENDING"] } },
            select: { customerId: true },
          })
        : [];
      const booked = new Set(futureBookings.map((b) => b.customerId));

      let le30 = 0, d31_60 = 0, d61_90 = 0, noBooking = 0;
      for (const r of rows) {
        const days = Math.ceil(((r.expiryDate?.getTime() ?? 0) - today.getTime()) / 86_400_000);
        if (days <= 30) le30++;
        else if (days <= 60) d31_60++;
        else d61_90++;
        if (!booked.has(r.customerId)) noBooking++;
      }

      return reply.send({ data: { le30, d31_60, d61_90, total: rows.length, noBooking }, errors: null });
    });

  // GET /dashboard/charts/appointments-by-month
  server.get("/dashboard/charts/appointments-by-month", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const qCenter = (request.query as { centerId?: string }).centerId;
      const cen = request.ctx.centerId ?? (qCenter || null);
      const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11); twelveMonthsAgo.setDate(1); twelveMonthsAgo.setHours(0, 0, 0, 0);

      const appointments = await prisma.appointment.findMany({
        where: { tenantId: tid, ...(cen ? { room: { centerId: cen } } : {}), scheduledAt: { gte: twelveMonthsAgo }, status: { notIn: ["CANCELLED"] } },
        select: { scheduledAt: true },
      });

      const byMonth: Record<string, number> = {};
      for (const a of appointments) {
        const key = `${a.scheduledAt.getFullYear()}-${String(a.scheduledAt.getMonth() + 1).padStart(2, "0")}`;
        byMonth[key] = (byMonth[key] ?? 0) + 1;
      }

      return reply.send({ data: Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)), errors: null });
    });

  // GET /dashboard/charts/customers-by-province — conteo de clientes por provincia
  server.get("/dashboard/charts/customers-by-province", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const grouped = await prisma.customer.groupBy({
        by: ["province"],
        where: { tenantId: request.ctx.tenantId, deletedAt: null },
        _count: { _all: true },
      });
      const data = grouped
        .map((g) => ({ province: g.province ?? "Sin provincia", count: g._count._all }))
        .sort((a, b) => b.count - a.count);
      return reply.send({ data, errors: null });
    });
}
