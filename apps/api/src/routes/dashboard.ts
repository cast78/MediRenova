import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";

export async function dashboardRoutes(server: FastifyInstance) {
  // GET /dashboard/summary — KPIs
  server.get("/dashboard/summary", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
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
        prisma.appointment.count({ where: { tenantId: tid, scheduledAt: { gte: todayStart, lte: todayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } } }),
        prisma.appointment.count({ where: { tenantId: tid, scheduledAt: { gte: todayStart, lte: weekEnd }, status: { notIn: ["CANCELLED", "NO_SHOW"] } } }),
        prisma.revision.count({ where: { tenantId: tid, outcome: "PENDING" } }),
        prisma.revision.count({ where: { tenantId: tid, outcome: { in: ["APTO", "NO_APTO"] }, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
        prisma.appointment.count({ where: { tenantId: tid, scheduledAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) }, status: { notIn: ["CANCELLED"] } } }),
      ]);

      const conversionRate = totalThisMonth > 0 ? Math.round((completedThisMonth / totalThisMonth) * 100) : 0;

      return reply.send({
        data: { appointmentsToday, appointmentsWeek, openRevisions, conversionRate },
        errors: null,
      });
    });

  // GET /dashboard/expirations — upcoming expirations
  server.get("/dashboard/expirations", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const in90 = new Date(today); in90.setDate(in90.getDate() + 90);

      const expirations = await prisma.revision.findMany({
        where: { tenantId: tid, expiryDate: { gte: today, lte: in90 }, outcome: "APTO" },
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

  // GET /dashboard/charts/appointments-by-month
  server.get("/dashboard/charts/appointments-by-month", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11); twelveMonthsAgo.setDate(1); twelveMonthsAgo.setHours(0, 0, 0, 0);

      const appointments = await prisma.appointment.findMany({
        where: { tenantId: tid, scheduledAt: { gte: twelveMonthsAgo }, status: { notIn: ["CANCELLED"] } },
        select: { scheduledAt: true },
      });

      const byMonth: Record<string, number> = {};
      for (const a of appointments) {
        const key = `${a.scheduledAt.getFullYear()}-${String(a.scheduledAt.getMonth() + 1).padStart(2, "0")}`;
        byMonth[key] = (byMonth[key] ?? 0) + 1;
      }

      return reply.send({ data: Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)), errors: null });
    });
}
