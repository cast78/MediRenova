import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { createHash } from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";
import { encryptDni } from "../lib/crypto.js";

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

function validateSpanishDni(dni: string): boolean {
  const clean = dni.toUpperCase().trim();
  const nieMap: Record<string, string> = { X: "0", Y: "1", Z: "2" };
  let normalized = clean;
  if (normalized[0] && nieMap[normalized[0]]) {
    normalized = nieMap[normalized[0]]! + normalized.slice(1);
  }
  const match = normalized.match(/^(\d{8})([A-Z])$/);
  if (!match) return false;
  const num = parseInt(match[1]!, 10);
  const letter = match[2]!;
  return DNI_LETTERS[num % 23] === letter;
}

const customerSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  dni: z.string().min(7).max(15),  // cleartext input, we store hash + encrypted
  birthDate: z.string().datetime().optional(),
  nationality: z.string().optional(),
  municipality: z.string().optional(),
  province: z.string().optional(),
  notes: z.string().optional(),
  gdprConsentAt: z.string().datetime().optional(),
  gdprConsentIp: z.string().optional(),
});

const listQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function hashDni(dni: string): string {
  return createHash("sha256").update(dni.toUpperCase().trim()).digest("hex");
}

export async function customerRoutes(server: FastifyInstance) {
  server.get("/customers", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;

      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId, deletedAt: null };
      if (query.q) {
        where["OR"] = [
          { firstName: { contains: query.q, mode: "insensitive" } },
          { lastName: { contains: query.q, mode: "insensitive" } },
          { email: { contains: query.q, mode: "insensitive" } },
          { phone: { contains: query.q } },
        ];
      }

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({ where, skip, take: query.limit, orderBy: { lastName: "asc" } }),
        prisma.customer.count({ where }),
      ]);

      return reply.send({
        data: customers,
        meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
        errors: null,
      });
    });

  server.post("/customers", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = customerSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const dniHash = hashDni(body.data.dni);
      if (!validateSpanishDni(body.data.dni)) {
        return reply.status(400).send({ errors: [{ code: "INVALID_DNI", message: "DNI/NIE con letra de control incorrecta" }] });
      }

      const existing = await prisma.customer.findFirst({ where: { tenantId: request.ctx.tenantId, dniHash } });
      if (existing) return reply.status(409).send({ errors: [{ code: "DNI_TAKEN", message: "DNI ya registrado" }] });

      const { dni, birthDate, gdprConsentAt, ...rest } = body.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customer = await prisma.customer.create({
        data: {
          tenantId: request.ctx.tenantId,
          ...stripUndefined(rest),
          dniHash,
          dniEncrypted: encryptDni(dni),
          birthDate: birthDate ? new Date(birthDate) : null,
          gdprConsentAt: gdprConsentAt ? new Date(gdprConsentAt) : null,
        } as any,
      });
      return reply.status(201).send({ data: customer, errors: null });
    });

  server.get<{ Params: { id: string } }>("/customers/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        include: {
          appointments: {
            include: { product: true, room: { include: { center: true } } },
            orderBy: { scheduledAt: "desc" },
            take: 10,
          },
        },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: customer, errors: null });
    });

  server.patch<{ Params: { id: string } }>("/customers/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const body = customerSchema.omit({ dni: true }).partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const updateData: Record<string, unknown> = stripUndefined({ ...body.data });
      if (body.data.birthDate) updateData["birthDate"] = new Date(body.data.birthDate);
      if (body.data.gdprConsentAt) updateData["gdprConsentAt"] = new Date(body.data.gdprConsentAt);

      const result = await prisma.customer.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        data: updateData,
      });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  // Revision history
  server.get<{ Params: { id: string } }>("/customers/:id/revisions", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const revisions = await prisma.revision.findMany({
        where: { appointment: { customerId: request.params.id, tenantId: request.ctx.tenantId } },
        include: {
          appointment: { include: { product: true } },
          doctor: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ data: revisions, errors: null });
    });

  // Soft delete
  server.delete<{ Params: { id: string } }>("/customers/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.customer.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: { deletedAt: new Date() },
      });
      return reply.status(204).send();
    });
}
