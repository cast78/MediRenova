import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { buildCustomerWhere, segmentDefinitionSchema, type SegmentDefinition } from "../lib/segments.js";

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  definition: segmentDefinitionSchema,
});

// Conteo en vivo + una muestra de nombres para la definición dada.
async function previewDefinition(def: SegmentDefinition) {
  const where = buildCustomerWhere(def);
  const [count, sample] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, take: 8, select: { id: true, firstName: true, lastName: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return { count, sample };
}

export async function segmentRoutes(server: FastifyInstance) {
  // GET /segments
  server.get("/segments", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const items = await prisma.segment.findMany({ where: { tenantId: request.ctx.tenantId }, orderBy: { updatedAt: "desc" } });
      return reply.send({ data: items, errors: null });
    });

  // POST /segments/preview — cuenta en vivo de una definición sin guardarla
  server.post("/segments/preview", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ definition: segmentDefinitionSchema }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      return reply.send({ data: await previewDefinition(body.data.definition), errors: null });
    });

  // POST /segments
  server.post("/segments", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = upsertSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const created = await prisma.segment.create({
        data: { tenantId: request.ctx.tenantId, name: body.data.name, definition: body.data.definition as Prisma.InputJsonValue },
      });
      return reply.status(201).send({ data: created, errors: null });
    });

  // PATCH /segments/:id
  server.patch<{ Params: { id: string } }>("/segments/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = upsertSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const data: Prisma.SegmentUpdateInput = {};
      if (body.data.name !== undefined) data.name = body.data.name;
      if (body.data.definition !== undefined) data.definition = body.data.definition as Prisma.InputJsonValue;
      const result = await prisma.segment.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const updated = await prisma.segment.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      return reply.send({ data: updated, errors: null });
    });

  // DELETE /segments/:id
  server.delete<{ Params: { id: string } }>("/segments/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const result = await prisma.segment.deleteMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { id: request.params.id }, errors: null });
    });
}
