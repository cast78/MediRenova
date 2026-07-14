import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";

const channelEnum = z.enum(["EMAIL", "WHATSAPP", "SMS"]);

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel: channelEnum,
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(5000),
  active: z.boolean().optional(),
});

// El email necesita asunto; otros canales no. Se valida sobre el objeto ya parseado.
function subjectOk(channel: string | undefined, subject: string | undefined): boolean {
  return channel !== "EMAIL" || !!subject?.trim();
}

export async function messageTemplateRoutes(server: FastifyInstance) {
  // GET /message-templates?channel=EMAIL
  server.get("/message-templates", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = z.object({ channel: channelEnum.optional() }).safeParse(request.query);
      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId };
      if (q.success && q.data.channel) where["channel"] = q.data.channel;
      const items = await prisma.messageTemplate.findMany({ where, orderBy: { updatedAt: "desc" } });
      // Uso en campañas por plantilla: nº de campañas y última vez que se usó.
      const usage = items.length
        ? await prisma.campaign.groupBy({
            by: ["templateId"],
            where: { tenantId: request.ctx.tenantId, templateId: { in: items.map((t) => t.id) } },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : [];
      const byTpl = new Map(usage.map((u) => [u.templateId, { count: u._count._all, last: u._max.createdAt }]));
      const data = items.map((t) => ({ ...t, campaignCount: byTpl.get(t.id)?.count ?? 0, lastUsedAt: byTpl.get(t.id)?.last ?? null }));
      return reply.send({ data, errors: null });
    });

  // POST /message-templates
  server.post("/message-templates", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = templateSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      if (!subjectOk(body.data.channel, body.data.subject)) {
        return reply.status(400).send({ errors: [{ code: "SUBJECT_REQUIRED", message: "El asunto es obligatorio para email" }] });
      }
      const created = await prisma.messageTemplate.create({
        data: {
          tenantId: request.ctx.tenantId,
          name: body.data.name,
          channel: body.data.channel,
          subject: body.data.subject ?? null,
          body: body.data.body,
          active: body.data.active ?? true,
        },
      });
      return reply.status(201).send({ data: created, errors: null });
    });

  // PATCH /message-templates/:id
  server.patch<{ Params: { id: string } }>("/message-templates/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = templateSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      // Valida coherencia asunto/canal con el estado resultante (mezcla lo enviado
      // con lo ya guardado) para no dejar un email sin asunto.
      const existing = await prisma.messageTemplate.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const channel = body.data.channel ?? existing.channel;
      const subject = body.data.subject ?? existing.subject ?? undefined;
      if (!subjectOk(channel, subject)) {
        return reply.status(400).send({ errors: [{ code: "SUBJECT_REQUIRED", message: "El asunto es obligatorio para email" }] });
      }

      const updated = await prisma.messageTemplate.update({
        where: { id: existing.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: stripUndefined(body.data) as any,
      });
      return reply.send({ data: updated, errors: null });
    });

  // DELETE /message-templates/:id
  server.delete<{ Params: { id: string } }>("/message-templates/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const result = await prisma.messageTemplate.deleteMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { id: request.params.id }, errors: null });
    });
}
