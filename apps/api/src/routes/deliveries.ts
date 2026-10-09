// Consulta de comunicaciones al paciente (crm-mensajeria): por cliente (ficha)
// y bandeja global + resumen (Configuración → Comunicaciones). Solo lectura; los
// avisos los crea `notify` desde los disparadores de cada módulo.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { EVENT_LABELS, type MessagingEvent } from "../lib/messaging/index.js";

const SELECT = {
  id: true, createdAt: true, sentAt: true, event: true, channel: true, provider: true, status: true,
  to: true, subject: true, body: true, cta: true, link: true, templateName: true, vars: true, reason: true, appointmentId: true,
  customer: { select: { id: true, firstName: true, lastName: true } },
  byUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.MessageDeliverySelect;

type Row = Prisma.MessageDeliveryGetPayload<{ select: typeof SELECT }>;

function shape(d: Row) {
  const { byUser, ...rest } = d;
  return {
    ...rest,
    eventLabel: EVENT_LABELS[d.event as MessagingEvent] ?? d.event,
    by: byUser ? `${byUser.firstName ?? ""} ${byUser.lastName ?? ""}`.trim() || null : null,
  };
}

const listQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).optional(),
  event: z.string().optional(),
  status: z.enum(["SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function deliveryRoutes(server: FastifyInstance) {
  // GET /customers/:id/deliveries — avisos de un paciente (ficha → Comunicaciones).
  server.get<{ Params: { id: string } }>("/customers/:id/deliveries", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const rows = await prisma.messageDelivery.findMany({
        where: { tenantId: request.ctx.tenantId, customerId: request.params.id },
        select: SELECT, orderBy: { createdAt: "desc" }, take: 200,
      });
      return reply.send({ data: rows.map(shape), errors: null });
    });

  // GET /deliveries — bandeja global con filtros.
  server.get("/deliveries", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = listQuery.safeParse(request.query);
      if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });
      const f = q.data;
      const where: Prisma.MessageDeliveryWhereInput = { tenantId: request.ctx.tenantId };
      if (f.from || f.to) where.createdAt = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) };
      if (f.channel) where.channel = f.channel;
      if (f.event) where.event = f.event;
      if (f.status) where.status = f.status;
      if (f.q?.trim()) {
        const s = f.q.trim();
        where.customer = { OR: [{ firstName: { contains: s, mode: "insensitive" } }, { lastName: { contains: s, mode: "insensitive" } }] };
      }
      const rows = await prisma.messageDelivery.findMany({ where, select: SELECT, orderBy: { createdAt: "desc" }, take: f.limit ?? 100 });
      return reply.send({ data: rows.map(shape), errors: null });
    });

  // GET /deliveries/summary?from&to — KPIs del periodo (por defecto, todo).
  server.get("/deliveries/summary", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).safeParse(request.query);
      if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });
      const where: Prisma.MessageDeliveryWhereInput = { tenantId: request.ctx.tenantId };
      if (q.data.from || q.data.to) where.createdAt = { ...(q.data.from ? { gte: new Date(q.data.from) } : {}), ...(q.data.to ? { lte: new Date(q.data.to) } : {}) };
      const rows = await prisma.messageDelivery.findMany({ where, select: { channel: true, status: true, provider: true } });
      const byChannel = { WHATSAPP: 0, SMS: 0, EMAIL: 0 };
      const byStatus = { SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0, SKIPPED: 0 };
      let simulated = 0;
      for (const r of rows) {
        if (r.channel) byChannel[r.channel]++;
        byStatus[r.status]++;
        if (r.provider === "demo" && r.status !== "SKIPPED") simulated++;
      }
      return reply.send({ data: { total: rows.length, byChannel, byStatus, simulated }, errors: null });
    });
}
