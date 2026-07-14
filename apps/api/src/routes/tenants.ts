import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";
import { email, emailConfigured, emailFrom } from "../lib/email.js";

const createTenantSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  primaryColor: z.string().optional(),
  timezone: z.string().optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  legalName: z.string().max(200).nullable().optional(),
  taxId: z.string().max(30).nullable().optional(),
  billingAddress: z.string().max(300).nullable().optional(),
});

const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const updateTenantConfigSchema = z.object({
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  logoUrl: z.string().nullable().optional(), // acepta URL o data URL (logo subido); null = quitar
  timezone: z.string().optional(),
  defaultSlotDuration: z.number().int().min(5).max(120).optional(),
  bookingGranularity: z.number().int().min(5).max(60).optional(),
  maxAppointmentsPerDay: z.number().int().min(1).optional(),
  metaWaPhoneNumberId: z.string().optional(),
  metaWaAccessToken: z.string().optional(),
  dataRetentionMonths: z.number().int().min(0).max(240).nullable().optional(),
  minBookingLeadHours: z.number().int().min(0).max(720).nullable().optional(),
  cancellationWindowHours: z.number().int().min(0).max(720).nullable().optional(),
  noShowGraceMinutes: z.number().int().min(0).max(240).nullable().optional(),
  consentText: z.string().max(5000).nullable().optional(),
  waitAmberMinutes: z.number().int().min(1).max(240).nullable().optional(),
  waitRedMinutes: z.number().int().min(1).max(240).nullable().optional(),
});

// Nunca exponer secretos del config al cliente: el token de Meta se sustituye por un
// flag `hasMetaWaToken`. El valor solo se escribe (PATCH), nunca se lee de vuelta.
function safeConfig<T extends { metaWaAccessToken?: string | null }>(config: T | null | undefined) {
  if (!config) return config ?? null;
  const { metaWaAccessToken, ...rest } = config;
  return { ...rest, hasMetaWaToken: !!metaWaAccessToken };
}

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
      return reply.send({ data: tenants.map((t) => ({ ...t, config: safeConfig(t.config) })), errors: null });
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

      return reply.status(201).send({ data: { ...tenant, config: safeConfig(tenant.config) }, errors: null });
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
      return reply.send({ data: { ...tenant, config: safeConfig(tenant.config) }, errors: null });
    },
  );

  // PATCH /tenants/me — datos de la empresa (nombre + fiscales).
  server.patch(
    "/tenants/me",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = updateTenantSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const tenant = await prisma.tenant.update({
        where: { id: request.ctx.tenantId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: stripUndefined(body.data) as any,
        include: { config: true },
      });
      return reply.send({ data: { ...tenant, config: safeConfig(tenant.config) }, errors: null });
    },
  );

  // POST /tenants/me/logo — sube el logo y lo guarda como data URL en el config.
  server.post(
    "/tenants/me/logo",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const file = await request.file();
      if (!file) return reply.status(400).send({ errors: [{ code: "NO_FILE" }] });
      if (!LOGO_MIME.has(file.mimetype)) return reply.status(400).send({ errors: [{ code: "INVALID_FILE_TYPE", message: "Solo PNG, JPG o WEBP" }] });
      const buffer = await file.toBuffer();
      if (file.file.truncated || buffer.length > 256 * 1024) return reply.status(413).send({ errors: [{ code: "FILE_TOO_LARGE", message: "El logo no puede superar 256 KB" }] });
      const dataUrl = `data:${file.mimetype};base64,${buffer.toString("base64")}`;
      await prisma.tenantConfig.update({ where: { tenantId: request.ctx.tenantId }, data: { logoUrl: dataUrl } });
      return reply.send({ data: { logoUrl: dataUrl }, errors: null });
    },
  );

  // GET /tenants/me/branding — branding del tenant (accesible a cualquier rol)
  server.get(
    "/tenants/me/branding",
    { preHandler: [requireRole("DOCTOR")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: request.ctx.tenantId },
        include: { config: { select: { logoUrl: true, primaryColor: true, secondaryColor: true, consentText: true } } },
      });
      if (!tenant) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({
        data: {
          name: tenant.name,
          logoUrl: tenant.config?.logoUrl ?? null,
          primaryColor: tenant.config?.primaryColor ?? "#2563eb",
          secondaryColor: tenant.config?.secondaryColor ?? "#64748b",
          consentText: tenant.config?.consentText ?? null,
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
      return reply.send({ data: safeConfig(config), errors: null });
    },
  );

  // GET /tenants/me/channels — estado real de cada canal de comunicación.
  server.get(
    "/tenants/me/channels",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId } });
      const whatsappReady = !!config?.metaWaPhoneNumberId && !!config?.metaWaAccessToken;
      return reply.send({
        data: {
          whatsapp: { status: whatsappReady ? "connected" : "pending", detail: whatsappReady ? "Credenciales presentes" : "Faltan Phone Number ID y/o Access Token" },
          email: { status: emailConfigured ? "connected" : "pending", from: emailConfigured ? emailFrom : null, detail: emailConfigured ? "Servidor de email configurado" : "Falta RESEND_API_KEY / EMAIL_FROM en el servidor" },
          sms: { status: "off", detail: "Sin proveedor de SMS integrado" },
        },
        errors: null,
      });
    },
  );

  // POST /tenants/me/channels/:channel/test — "Probar conexión".
  server.post<{ Params: { channel: string } }>(
    "/tenants/me/channels/:channel/test",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const channel = request.params.channel;

      if (channel === "email") {
        if (!emailConfigured) return reply.send({ data: { ok: false, message: "Email no configurado en el servidor (RESEND_API_KEY / EMAIL_FROM)." }, errors: null });
        const user = await prisma.user.findUnique({ where: { id: request.ctx.userId }, select: { email: true, firstName: true } });
        if (!user?.email) return reply.send({ data: { ok: false, message: "Tu usuario no tiene email para la prueba." }, errors: null });
        try {
          await email.sendEmail({
            to: user.email,
            subject: "Prueba de conexión · MediRenova",
            body: `Hola ${user.firstName ?? ""}, este es un email de prueba desde la configuración de MediRenova. Si lo recibes, el canal de email funciona.`,
          });
          return reply.send({ data: { ok: true, message: `Email de prueba enviado a ${user.email}. Revisa tu bandeja.` }, errors: null });
        } catch {
          return reply.send({ data: { ok: false, message: "El proveedor de email rechazó el envío. Revisa la clave y el remitente." }, errors: null });
        }
      }

      if (channel === "whatsapp") {
        const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId } });
        if (!config?.metaWaPhoneNumberId || !config?.metaWaAccessToken) {
          return reply.send({ data: { ok: false, message: "Faltan Phone Number ID y/o Access Token." }, errors: null });
        }
        return reply.send({ data: { ok: true, message: "Credenciales presentes. El envío real requiere plantillas aprobadas por Meta (pendiente)." }, errors: null });
      }

      if (channel === "sms") {
        return reply.send({ data: { ok: false, message: "SMS aún no tiene proveedor integrado." }, errors: null });
      }

      return reply.status(400).send({ errors: [{ code: "UNKNOWN_CHANNEL" }] });
    },
  );

  // GET /tenants/me/audit — visor del registro de auditoría (quién hizo qué).
  server.get(
    "/tenants/me/audit",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = z.object({
        action: z.enum(["CREATE", "UPDATE", "DELETE"]).optional(),
        resourceType: z.string().optional(),
        userId: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }).safeParse(request.query);
      if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });
      const { action, resourceType, userId, from, to, page, limit } = q.data;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { tenantId: request.ctx.tenantId };
      if (action) where.action = action;
      if (resourceType) where.resourceType = resourceType;
      if (userId) where.userId = userId;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
      }

      const [rows, total, types] = await Promise.all([
        prisma.auditLog.findMany({
          where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit,
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        }),
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({ where: { tenantId: request.ctx.tenantId }, select: { resourceType: true }, distinct: ["resourceType"], orderBy: { resourceType: "asc" } }),
      ]);
      return reply.send({
        data: rows,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
        resourceTypes: types.map((t) => t.resourceType),
        errors: null,
      });
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
