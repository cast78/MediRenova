import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";

const ageRuleSchema = z.object({
  minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120),
  validityDays: z.number().int().min(0), // 0 = no permitido
});

const renewalRulesSchema = z.object({
  requiresMedical: z.boolean().optional(),
  requiresPsych: z.boolean().optional(),
  requiresVision: z.boolean().optional(),
  // Simple single validity (no age ranges)
  validityDays: z.number().int().min(1).optional(),
  // Age-based ranges
  ageRules: z.array(ageRuleSchema).optional(),
});

function validateAgeRuleCoverage(rules: { minAge: number; maxAge: number; validityDays: number }[]): string | null {
  if (rules.length === 0) return null;
  const sorted = [...rules].sort((a, b) => a.minAge - b.minAge);
  if (sorted[0]!.minAge !== 0) return "Los tramos deben comenzar en edad 0";
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.minAge !== sorted[i - 1]!.maxAge + 1) {
      return `Hay un hueco o solapamiento entre los tramos ${sorted[i - 1]!.maxAge} y ${sorted[i]!.minAge}`;
    }
  }
  if (sorted[sorted.length - 1]!.maxAge < 120) {
    return "Los tramos deben cubrir hasta edad 120";
  }
  return null;
}

const productSchema = z.object({
  name: z.string().min(2).max(150),
  type: z.enum(["CARNET_CONDUCIR", "LICENCIA_ARMAS", "DNI", "OTRO"]),
  slotDuration: z.number().int().min(5),
  renewalRules: renewalRulesSchema.optional(),
  active: z.boolean().optional(),
});

export async function productRoutes(server: FastifyInstance) {
  server.get("/products", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const products = await prisma.product.findMany({
        where: { tenantId: request.ctx.tenantId },
        orderBy: { name: "asc" },
      });
      return reply.send({ data: products, errors: null });
    });

  server.post("/products", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = productSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const ageRules = body.data.renewalRules?.ageRules;
      if (ageRules && ageRules.length > 0) {
        const coverageError = validateAgeRuleCoverage(ageRules);
        if (coverageError) return reply.status(400).send({ errors: [{ code: "INVALID_AGE_RULES", message: coverageError }] });
      }
      const product = await prisma.product.create({
        data: {
          tenantId: request.ctx.tenantId,
          name: body.data.name,
          type: body.data.type,
          slotDuration: body.data.slotDuration,
          renewalRules: body.data.renewalRules ?? {},
          active: body.data.active ?? true,
        },
      });
      return reply.status(201).send({ data: product, errors: null });
    });

  server.get<{ Params: { id: string } }>("/products/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: product, errors: null });
    });

  server.patch<{ Params: { id: string } }>("/products/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = productSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const ageRules = body.data.renewalRules?.ageRules;
      if (ageRules && ageRules.length > 0) {
        const coverageError = validateAgeRuleCoverage(ageRules);
        if (coverageError) return reply.status(400).send({ errors: [{ code: "INVALID_AGE_RULES", message: coverageError }] });
      }
      const updateData: Record<string, unknown> = {};
      if (body.data.name !== undefined) updateData["name"] = body.data.name;
      if (body.data.type !== undefined) updateData["type"] = body.data.type;
      if (body.data.slotDuration !== undefined) updateData["slotDuration"] = body.data.slotDuration;
      if (body.data.renewalRules !== undefined) updateData["renewalRules"] = body.data.renewalRules;
      if (body.data.active !== undefined) updateData["active"] = body.data.active;
      const result = await prisma.product.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: updateData });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  server.delete<{ Params: { id: string } }>("/products/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.product.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: { active: false } });
      return reply.status(204).send();
    });
}
