import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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

  // PATCH /forms/:id — edita el formulario. Si cambian los campos se crea una
  // NUEVA versión (preservando la anterior para el historial y las revisiones que
  // la referencian); si solo cambia el nombre, se actualiza en sitio.
  server.patch<{ Params: { id: string } }>("/forms/:id",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = z.object({ name: z.string().min(2).optional(), fields: formFieldsSchema.optional() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.formTemplate.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const product = await prisma.product.findFirst({ where: { id: existing.productId, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const newName = body.data.name ?? existing.name;

      // ¿Cambiaron realmente los campos? Comparación canónica (ignora el orden de claves).
      let fieldsChanged = false;
      if (body.data.fields) {
        const fieldsError = validateFormFields(body.data.fields);
        if (fieldsError) return reply.status(400).send({ errors: [{ code: "INVALID_FORM_SCHEMA", message: fieldsError }] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canon = (f: any) => JSON.stringify({ name: f?.name, label: f?.label, type: f?.type, required: !!f?.required, options: f?.options ?? null, unit: f?.unit ?? null });
        const incoming = body.data.fields.map(canon).join("|");
        const current = (((existing.schema as { fields?: unknown })?.fields ?? []) as unknown[]).map(canon).join("|");
        fieldsChanged = incoming !== current;
      }

      // Sin cambios de campos → solo nombre, en sitio.
      if (!fieldsChanged) {
        const updated = await prisma.formTemplate.update({ where: { id: existing.id }, data: { name: newName } });
        return reply.send({ data: updated, errors: null });
      }

      // Campos cambiados → nueva versión = (mayor del producto) + 1, preservando la anterior.
      const latest = await prisma.formTemplate.findFirst({ where: { productId: existing.productId }, orderBy: { version: "desc" } });
      const version = (latest?.version ?? existing.version) + 1;

      try {
        const [, created] = await prisma.$transaction([
          // Archiva la versión editada (si estaba activa, deja de estarlo a favor de la nueva).
          prisma.formTemplate.update({ where: { id: existing.id }, data: { isActive: false } }),
          prisma.formTemplate.create({
            data: {
              productId: existing.productId,
              name: newName,
              version,
              schema: { fields: body.data.fields },
              basedOnId: existing.id,
              createdById: request.ctx.userId,
              isActive: existing.isActive, // la nueva versión hereda el estado activo
            },
          }),
        ]);
        return reply.send({ data: created, errors: null });
      } catch (err) {
        // Colisión de versión por carrera concurrente → 409 limpio en vez de 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return reply.status(409).send({ errors: [{ code: "VERSION_CONFLICT", message: "Otra edición creó una versión a la vez; reintenta." }] });
        }
        throw err;
      }
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
