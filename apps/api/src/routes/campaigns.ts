import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { sendCampaign } from "../lib/campaign-runner.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().uuid(),
  segmentId: z.string().uuid(),
  // Fecha/hora ISO opcional: si viene → SCHEDULED; si no → DRAFT (se envía a mano).
  scheduledAt: z.string().datetime().optional(),
});

export async function campaignRoutes(server: FastifyInstance) {
  // GET /campaigns
  server.get("/campaigns", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const items = await prisma.campaign.findMany({
        where: { tenantId: request.ctx.tenantId },
        include: { template: { select: { name: true } }, segment: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ data: items, errors: null });
    });

  // GET /campaigns/:id — detalle + destinatarios (traza por cliente)
  server.get<{ Params: { id: string } }>("/campaigns/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const campaign = await prisma.campaign.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        include: {
          template: { select: { id: true, name: true, channel: true } },
          segment: { select: { id: true, name: true } },
          recipients: {
            take: 300,
            orderBy: { status: "asc" },
            include: { customer: { select: { firstName: true, lastName: true } } },
          },
        },
      });
      if (!campaign) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: campaign, errors: null });
    });

  // POST /campaigns — crea borrador (o programada si trae scheduledAt)
  server.post("/campaigns", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const template = await prisma.messageTemplate.findFirst({ where: { id: body.data.templateId, tenantId: request.ctx.tenantId } });
      if (!template) return reply.status(400).send({ errors: [{ code: "INVALID_TEMPLATE" }] });
      const segment = await prisma.segment.findFirst({ where: { id: body.data.segmentId, tenantId: request.ctx.tenantId } });
      if (!segment) return reply.status(400).send({ errors: [{ code: "INVALID_SEGMENT" }] });

      const created = await prisma.campaign.create({
        data: {
          tenantId: request.ctx.tenantId,
          name: body.data.name,
          channel: template.channel, // el canal se deriva de la plantilla
          templateId: template.id,
          segmentId: segment.id,
          status: body.data.scheduledAt ? "SCHEDULED" : "DRAFT",
          scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : null,
        },
      });
      return reply.status(201).send({ data: created, errors: null });
    });

  // POST /campaigns/:id/send — envía ahora (inline). Solo borrador/programada.
  server.post<{ Params: { id: string } }>("/campaigns/:id/send", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const campaign = await prisma.campaign.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!campaign) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
        return reply.status(409).send({ errors: [{ code: "NOT_SENDABLE", message: "La campaña ya se envió o está en curso" }] });
      }
      await sendCampaign(campaign.id, request.ctx.tenantId);
      const updated = await prisma.campaign.findFirst({ where: { id: campaign.id, tenantId: request.ctx.tenantId } });
      return reply.send({ data: updated, errors: null });
    });

  // DELETE /campaigns/:id — solo si no se ha enviado
  server.delete<{ Params: { id: string } }>("/campaigns/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const campaign = await prisma.campaign.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!campaign) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (campaign.status === "SENDING") return reply.status(409).send({ errors: [{ code: "SENDING", message: "No se puede borrar una campaña en curso" }] });
      await prisma.campaign.delete({ where: { id: campaign.id } });
      return reply.send({ data: { id: campaign.id }, errors: null });
    });
}
