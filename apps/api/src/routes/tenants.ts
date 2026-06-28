import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";

const createTenantSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  primaryColor: z.string().optional(),
  timezone: z.string().optional(),
});

const updateTenantConfigSchema = z.object({
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  logoUrl: z.string().url().optional(),
  timezone: z.string().optional(),
  defaultSlotDuration: z.number().int().min(5).max(120).optional(),
  bookingGranularity: z.number().int().min(5).max(60).optional(),
  maxAppointmentsPerDay: z.number().int().min(1).optional(),
  metaWaPhoneNumberId: z.string().optional(),
  metaWaAccessToken: z.string().optional(),
});

export async function tenantRoutes(server: FastifyInstance) {
  // GET /admin/tenants — superadmin only
  server.get(
    "/admin/tenants",
    { preHandler: [requireRole("SUPERADMIN")] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const tenants = await prisma.tenant.findMany({
        include: { config: true },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({ data: tenants, errors: null });
    },
  );

  // POST /admin/tenants — superadmin only
  server.post(
    "/admin/tenants",
    { preHandler: [requireRole("SUPERADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createTenantSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.tenant.findUnique({ where: { slug: body.data.slug } });
      if (existing) return reply.status(409).send({ errors: [{ code: "SLUG_TAKEN", message: "Slug ya en uso" }] });

      const tenant = await prisma.tenant.create({
        data: {
          name: body.data.name,
          slug: body.data.slug,
          config: {
            create: {
              primaryColor: body.data.primaryColor ?? "#2563eb",
              timezone: body.data.timezone ?? "Europe/Madrid",
            },
          },
        },
        include: { config: true },
      });

      return reply.status(201).send({ data: tenant, errors: null });
    },
  );

  // GET /tenants/me — current tenant info
  server.get(
    "/tenants/me",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: request.ctx.tenantId },
        include: { config: true },
      });
      if (!tenant) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: tenant, errors: null });
    },
  );

  // GET /tenants/me/branding — branding del tenant (accesible a cualquier rol)
  server.get(
    "/tenants/me/branding",
    { preHandler: [requireRole("DOCTOR")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: request.ctx.tenantId },
        include: { config: { select: { logoUrl: true, primaryColor: true, secondaryColor: true } } },
      });
      if (!tenant) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({
        data: {
          name: tenant.name,
          logoUrl: tenant.config?.logoUrl ?? null,
          primaryColor: tenant.config?.primaryColor ?? "#2563eb",
          secondaryColor: tenant.config?.secondaryColor ?? "#64748b",
        },
        errors: null,
      });
    },
  );

  // PATCH /tenants/me/config
  server.patch(
    "/tenants/me/config",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = updateTenantConfigSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = await prisma.tenantConfig.update({
        where: { tenantId: request.ctx.tenantId },
        data: stripUndefined(body.data) as any,
      });
      return reply.send({ data: config, errors: null });
    },
  );

  // GET /tenants/me/api-keys
  server.get(
    "/tenants/me/api-keys",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const keys = await prisma.apiKey.findMany({
        where: { tenantId: request.ctx.tenantId },
        select: { id: true, name: true, prefix: true, active: true, createdAt: true, revokedAt: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ data: keys, errors: null });
    },
  );

  // POST /tenants/me/api-keys
  server.post(
    "/tenants/me/api-keys",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { generateApiKey } = await import("../lib/crypto.js");
      const body = z.object({ name: z.string().min(2).max(100) }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const { raw, hash, prefix } = generateApiKey();
      const apiKey = await prisma.apiKey.create({
        data: { tenantId: request.ctx.tenantId, name: body.data.name, keyHash: hash, prefix },
      });

      // Return raw key only once
      return reply.status(201).send({ data: { ...apiKey, key: raw }, errors: null });
    },
  );

  // DELETE /tenants/me/api-keys/:id
  server.delete<{ Params: { id: string } }>(
    "/tenants/me/api-keys/:id",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.apiKey.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: { revokedAt: new Date() },
      });
      return reply.status(204).send();
    },
  );
}
