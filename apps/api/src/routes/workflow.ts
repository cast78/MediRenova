import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";

const workflowRuleSchema = z.object({
  productId: z.string().uuid(),
  daysBeforeExpiry: z.number().int().min(1).max(365),
  actionType: z.enum(["WHATSAPP"]),
  templateName: z.string().min(1),
  retryEveryDays: z.number().int().min(1).default(15),
  maxRetries: z.number().int().min(0).default(3),
  active: z.boolean().optional(),
});

export async function workflowRoutes(server: FastifyInstance) {
  // GET /workflow-rules
  server.get("/workflow-rules", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rules = await prisma.workflowRule.findMany({
        where: { tenantId: request.ctx.tenantId },
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ data: rules, errors: null });
    });

  // POST /workflow-rules
  server.post("/workflow-rules", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = workflowRuleSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const product = await prisma.product.findFirst({ where: { id: body.data.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = await prisma.workflowRule.create({
        data: { tenantId: request.ctx.tenantId, ...stripUndefined(body.data) } as any,
      });
      return reply.status(201).send({ data: rule, errors: null });
    });

  // PATCH /workflow-rules/:id
  server.patch<{ Params: { id: string } }>("/workflow-rules/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = workflowRuleSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await prisma.workflowRule.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: stripUndefined(body.data) as any,
      });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  // DELETE /workflow-rules/:id
  server.delete<{ Params: { id: string } }>("/workflow-rules/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.workflowRule.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: { active: false } });
      return reply.status(204).send();
    });
}
