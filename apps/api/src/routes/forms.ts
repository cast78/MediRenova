import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { formFieldsSchema, validateFormFields } from "../lib/form-schema.js";

const createSchema = z.object({
  name: z.string().min(2).max(150),
  fields: formFieldsSchema,
});

export async function formRoutes(server: FastifyInstance) {
  // GET /products/:productId/forms — todas las versiones del producto
  server.get<{ Params: { productId: string } }>("/products/:productId/forms",
    { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({ where: { id: request.params.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const forms = await prisma.formTemplate.findMany({
        where: { productId: request.params.productId },
        orderBy: { version: "desc" },
      });
      return reply.send({ data: forms, errors: null });
    });

  // POST /products/:productId/forms — crea una nueva versión (draft, inactiva)
  server.post<{ Params: { productId: string } }>("/products/:productId/forms",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({ where: { id: request.params.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const body = createSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const fieldsError = validateFormFields(body.data.fields);
      if (fieldsError) return reply.status(400).send({ errors: [{ code: "INVALID_FORM_SCHEMA", message: fieldsError }] });

      const latest = await prisma.formTemplate.findFirst({ where: { productId: request.params.productId }, orderBy: { version: "desc" } });
      const version = (latest?.version ?? 0) + 1;

      const form = await prisma.formTemplate.create({
        data: {
          productId: request.params.productId,
          name: body.data.name,
          version,
          schema: { fields: body.data.fields },
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
      const product = await prisma.product.findFirst({ where: { id: form.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: form, errors: null });
    });

  // PATCH /forms/:id — edita nombre y/o campos (bump de versión al cambiar campos)
  server.patch<{ Params: { id: string } }>("/forms/:id",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = z.object({ name: z.string().min(2).optional(), fields: formFieldsSchema.optional() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.formTemplate.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const product = await prisma.product.findFirst({ where: { id: existing.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const updateData: Record<string, unknown> = {};
      if (body.data.name) updateData["name"] = body.data.name;
      if (body.data.fields) {
        const fieldsError = validateFormFields(body.data.fields);
        if (fieldsError) return reply.status(400).send({ errors: [{ code: "INVALID_FORM_SCHEMA", message: fieldsError }] });
        updateData["schema"] = { fields: body.data.fields };
        updateData["version"] = existing.version + 1;
      }

      const updated = await prisma.formTemplate.update({ where: { id: request.params.id }, data: updateData });
      return reply.send({ data: updated, errors: null });
    });

  // POST /forms/:id/activate — activa esta versión y desactiva las demás del producto (7.5)
  server.post<{ Params: { id: string } }>("/forms/:id/activate",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const existing = await prisma.formTemplate.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const product = await prisma.product.findFirst({ where: { id: existing.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      await prisma.$transaction([
        prisma.formTemplate.updateMany({ where: { productId: existing.productId, isActive: true }, data: { isActive: false } }),
        prisma.formTemplate.update({ where: { id: request.params.id }, data: { isActive: true } }),
      ]);
      return reply.send({ data: { activated: true }, errors: null });
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
