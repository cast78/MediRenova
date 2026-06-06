import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "number", "date", "select", "checkbox", "textarea", "signature"]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  order: z.number().int().min(0),
  section: z.string().optional(),
  helpText: z.string().optional(),
});

const formTemplateSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(2).max(150),
  fields: z.array(fieldSchema).min(1),
});

export async function formRoutes(server: FastifyInstance) {
  // GET /products/:productId/forms
  server.get<{ Params: { productId: string } }>("/products/:productId/forms",
    { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      // Verify product belongs to tenant
      const product = await prisma.product.findFirst({ where: { id: request.params.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const forms = await prisma.formTemplate.findMany({
        where: { productId: request.params.productId },
        orderBy: { version: "desc" },
      });
      return reply.send({ data: forms, errors: null });
    });

  // POST /products/:productId/forms
  server.post<{ Params: { productId: string } }>("/products/:productId/forms",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({ where: { id: request.params.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const body = formTemplateSchema.omit({ productId: true }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      // Find max version for this product
      const latest = await prisma.formTemplate.findFirst({ where: { productId: request.params.productId }, orderBy: { version: "desc" } });
      const version = (latest?.version ?? 0) + 1;

      const form = await prisma.formTemplate.create({
        data: {
          productId: request.params.productId,
          name: body.data.name,
          version,
          schema: body.data.fields,
          createdById: request.ctx.userId,
          isActive: false,
        },
      });
      return reply.status(201).send({ data: form, errors: null });
    });

  // GET /forms/:id
  server.get<{ Params: { id: string } }>("/forms/:id",
    { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const form = await prisma.formTemplate.findUnique({ where: { id: request.params.id } });
      if (!form) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      // Verify tenant access via product
      const product = await prisma.product.findFirst({ where: { id: form.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: form, errors: null });
    });

  // PATCH /forms/:id
  server.patch<{ Params: { id: string } }>("/forms/:id",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = z.object({ name: z.string().optional(), fields: z.array(fieldSchema).optional(), isActive: z.boolean().optional() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.formTemplate.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const product = await prisma.product.findFirst({ where: { id: existing.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const updateData: Record<string, unknown> = {};
      if (body.data.name) updateData["name"] = body.data.name;
      if (body.data.fields) { updateData["schema"] = body.data.fields; updateData["version"] = existing.version + 1; }
      if (body.data.isActive !== undefined) updateData["isActive"] = body.data.isActive;

      const updated = await prisma.formTemplate.update({ where: { id: request.params.id }, data: updateData });
      return reply.send({ data: updated, errors: null });
    });

  // DELETE /forms/:id
  server.delete<{ Params: { id: string } }>("/forms/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const existing = await prisma.formTemplate.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const product = await prisma.product.findFirst({ where: { id: existing.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      await prisma.formTemplate.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    });
}
