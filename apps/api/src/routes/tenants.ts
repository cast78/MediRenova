import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireFeature, isProPreview } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";
import { email, emailConfigured, emailFrom } from "../lib/email.js";
import { whatsappConfigured } from "../lib/whatsapp.js";
import { effectivePlan, features, FEATURES, FEATURE_KEYS } from "../lib/plan.js";

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
      const centersCount = await prisma.center.count({ where: { tenantId: tenant.id, active: true } });
      return reply.send({
        data: {
          ...tenant,
          config: safeConfig(tenant.config),
          // Plan (crm-planes): contratado, efectivo (prueba) y funciones resueltas.
          effectivePlan: effectivePlan(tenant),
          features: features(tenant),
          centersCount,
        },
        errors: null,
      });
    },
  );

  // GET /tenants/me/plan — plan y funciones para cualquier usuario autenticado
  // (el menú y los candados los necesitan también recepción y médicos).
  server.get(
    "/tenants/me/plan",
    { preHandler: [requireRole("DOCTOR")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: request.ctx.tenantId },
        select: { plan: true, trialUntil: true, featureOverrides: true, maxCenters: true },
      });
      if (!tenant) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const centersCount = await prisma.center.count({ where: { tenantId: request.ctx.tenantId, active: true } });
      // "Ver como Pro" (solo superadmin): todo abierto, marcado como vista previa.
      const preview = isProPreview(request);
      // Petición pendiente (prueba o contratación) y si aún puede pedir la prueba
      // (P4c, opción B): Esencial, sin prueba en curso, sin petición abierta y sin
      // prueba aprobada antes. Nada se activa sin el proveedor.
      const trialActive = !!tenant.trialUntil && tenant.trialUntil > new Date();
      const [pending, approvedTrial] = await Promise.all([
        prisma.planRequest.findFirst({ where: { tenantId: request.ctx.tenantId, status: "OPEN" }, select: { id: true, kind: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
        prisma.planRequest.findFirst({ where: { tenantId: request.ctx.tenantId, kind: "TRIAL", status: "APPROVED" }, select: { id: true } }),
      ]);
      const lastDecision = await prisma.planRequest.findFirst({ where: { tenantId: request.ctx.tenantId, status: "REJECTED" }, select: { kind: true, closedAt: true, note: true }, orderBy: { closedAt: "desc" } });
      const selfTrialAvailable = tenant.plan === "ESSENTIAL" && !trialActive && !pending && !approvedTrial;
      return reply.send({
        data: {
          plan: tenant.plan, effectivePlan: preview ? "PRO" : effectivePlan(tenant), trialUntil: tenant.trialUntil,
          features: preview ? FEATURE_KEYS : features(tenant), centersCount, maxCenters: tenant.maxCenters, preview, selfTrialAvailable,
          pendingRequest: pending, lastRejected: lastDecision,
          // Catálogo para que el front pinte "incluye / no incluye" sin duplicarlo.
          catalog: FEATURE_KEYS.map((k) => ({ key: k, label: FEATURES[k].label, min: FEATURES[k].min })),
        },
        errors: null,
      });
    },
  );

  // POST /tenants/me/plan-request — "Quiero pasar a Pro" desde la clínica (ADMIN).
  // Crea la petición (una abierta por empresa) y avisa al proveedor por email.
  server.post(
    "/tenants/me/plan-request",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ feature: z.string().max(60).optional(), note: z.string().max(500).optional() }).safeParse(request.body ?? {});
      const note = body.success ? [body.data.feature, body.data.note].filter(Boolean).join(" · ") || null : null;
      const open = await prisma.planRequest.findFirst({ where: { tenantId: request.ctx.tenantId, status: "OPEN" }, select: { id: true } });
      if (open) return reply.send({ data: { id: open.id, alreadyOpen: true }, errors: null });
      const created = await prisma.planRequest.create({
        data: { tenantId: request.ctx.tenantId, kind: "UPGRADE", requestedPlan: "PRO", byUserId: request.ctx.userId ?? null, note },
      });
      // Aviso al proveedor: los superadmin viven en la empresa "system" (se leen por
      // la relación del tenant para no chocar con el aislamiento por empresa).
      const [tenant, system] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: request.ctx.tenantId }, select: { name: true, slug: true } }),
        prisma.tenant.findUnique({ where: { slug: "system" }, select: { users: { where: { role: "SUPERADMIN", active: true }, select: { email: true } } } }),
      ]);
      for (const u of system?.users ?? []) {
        try {
          await email.sendEmail({
            to: u.email,
            subject: `Petición de plan Pro · ${tenant?.name ?? request.ctx.tenantId}`,
            body: `La empresa ${tenant?.name ?? ""} (${tenant?.slug ?? ""}) ha pedido pasar al plan Pro.${note ? `\nMotivo: ${note}` : ""}\n\nGestiónala desde el panel de proveedor.`,
          });
        } catch (err) { request.log.error(err, "[planes] aviso de petición falló"); }
      }
      return reply.status(201).send({ data: { id: created.id, alreadyOpen: false }, errors: null });
    },
  );

  // POST /tenants/me/center-request — pedir un centro adicional sobre el límite
  // contratado (crm-planes P4c): petición de tipo CENTER que el proveedor aprueba
  // (sube el límite) o rechaza. Nada cambia hasta entonces.
  server.post(
    "/tenants/me/center-request",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const body = z.object({ note: z.string().max(300).optional() }).safeParse(request.body ?? {});
      const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { name: true, slug: true, maxCenters: true } });
      if (!tenant) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const pending = await prisma.planRequest.findFirst({ where: { tenantId: tid, status: "OPEN" }, select: { id: true, kind: true } });
      if (pending) return reply.send({ data: { id: pending.id, kind: pending.kind, alreadyOpen: true }, errors: null });
      const centers = await prisma.center.count({ where: { tenantId: tid, active: true } });
      const created = await prisma.planRequest.create({
        data: { tenantId: tid, kind: "CENTER", requestedPlan: "PRO", byUserId: request.ctx.userId ?? null, note: `Centro adicional (${centers} de ${tenant.maxCenters ?? "∞"} contratados)${body.success && body.data.note ? ` · ${body.data.note}` : ""}` },
      });
      const system = await prisma.tenant.findUnique({ where: { slug: "system" }, select: { users: { where: { role: "SUPERADMIN", active: true }, select: { email: true } } } });
      for (const u of system?.users ?? []) {
        try {
          await email.sendEmail({ to: u.email, subject: `Petición de centro adicional · ${tenant.name}`, body: `La empresa ${tenant.name} (${tenant.slug}) pide un centro adicional (tiene ${centers} de ${tenant.maxCenters ?? "sin límite"} contratados).\n\nApruébala o recházala desde el panel de proveedor (Peticiones).` });
        } catch (err) { request.log.error(err, "[planes] aviso de petición de centro falló"); }
      }
      return reply.status(201).send({ data: { id: created.id, kind: "CENTER", alreadyOpen: false }, errors: null });
    },
  );

  // GET /tenants/me/plan-teasers — cifras propias y seguras para las páginas
  // bloqueadas (crm-planes P4c.2): una cifra por módulo, nunca su contenido.
  server.get(
    "/tenants/me/plan-teasers",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const now = new Date();
      const since30 = new Date(now.getTime() - 30 * 86_400_000);
      const in60 = new Date(now.getTime() + 60 * 86_400_000);
      const [noShows30d, appointments30d, created30d, expiring60d, consented, newCustomers30d] = await Promise.all([
        prisma.appointment.count({ where: { tenantId: tid, status: "NO_SHOW", scheduledAt: { gte: since30 } } }),
        prisma.appointment.count({ where: { tenantId: tid, scheduledAt: { gte: since30, lte: now } } }),
        prisma.appointment.count({ where: { tenantId: tid, createdAt: { gte: since30 } } }),
        prisma.revision.count({ where: { tenantId: tid, outcome: "APTO", expiryDate: { gte: now, lte: in60 } } }),
        prisma.customer.count({ where: { tenantId: tid, deletedAt: null, OR: [{ acceptsEmail: true }, { acceptsWhatsapp: true }, { acceptsSms: true }] } }),
        prisma.customer.count({ where: { tenantId: tid, deletedAt: null, createdAt: { gte: since30 } } }),
      ]);
      return reply.send({ data: { noShows30d, appointments30d, created30d, expiring60d, consented, newCustomers30d }, errors: null });
    },
  );

  // POST /tenants/me/trial — pedir la prueba Pro de 14 días (crm-planes P4c.1,
  // opción B): crea una petición de tipo TRIAL que el proveedor aprueba o rechaza
  // desde su panel. NADA se activa aquí. Una prueba aprobada por empresa.
  server.post(
    "/tenants/me/trial",
    { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tid = request.ctx.tenantId;
      const now = new Date();
      const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { name: true, slug: true, plan: true, trialUntil: true } });
      if (!tenant) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (tenant.plan === "PRO") return reply.status(409).send({ errors: [{ code: "ALREADY_PRO", message: "Tu empresa ya tiene el plan Pro." }] });
      if (tenant.trialUntil && tenant.trialUntil > now) return reply.status(409).send({ errors: [{ code: "TRIAL_ACTIVE", message: "Ya tienes una prueba Pro en curso." }] });
      const [approvedBefore, pending] = await Promise.all([
        prisma.planRequest.findFirst({ where: { tenantId: tid, kind: "TRIAL", status: "APPROVED" }, select: { id: true } }),
        prisma.planRequest.findFirst({ where: { tenantId: tid, status: "OPEN" }, select: { id: true, kind: true } }),
      ]);
      if (approvedBefore) return reply.status(409).send({ errors: [{ code: "TRIAL_USED", message: "La prueba gratuita ya se usó. Pide pasar a Pro y te contactaremos." }] });
      if (pending) return reply.send({ data: { id: pending.id, kind: pending.kind, alreadyOpen: true }, errors: null });

      const created = await prisma.planRequest.create({
        data: { tenantId: tid, kind: "TRIAL", requestedPlan: "PRO", byUserId: request.ctx.userId ?? null, note: "Prueba Pro de 14 días" },
      });
      const system = await prisma.tenant.findUnique({ where: { slug: "system" }, select: { users: { where: { role: "SUPERADMIN", active: true }, select: { email: true } } } });
      for (const u of system?.users ?? []) {
        try {
          await email.sendEmail({ to: u.email, subject: `Petición de prueba Pro · ${tenant.name}`, body: `La empresa ${tenant.name} (${tenant.slug}) pide la prueba Pro de 14 días.\n\nApruébala o recházala desde el panel de proveedor (Peticiones).` });
        } catch (err) { request.log.error(err, "[planes] aviso de petición de prueba falló"); }
      }
      return reply.status(201).send({ data: { id: created.id, kind: "TRIAL", alreadyOpen: false }, errors: null });
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
    { preHandler: [requireRole("ADMIN"), requireFeature("channels")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const config = await prisma.tenantConfig.findUnique({ where: { tenantId: request.ctx.tenantId } });
      const whatsappReady = !!config?.metaWaPhoneNumberId && !!config?.metaWaAccessToken;
      return reply.send({
        data: {
          // `mode`: "live" = el aviso sale de verdad por el proveedor; "demo" = se
          // redacta y se registra en Comunicaciones sin enviarse (crm-mensajeria).
          whatsapp: { status: whatsappReady ? "connected" : "pending", mode: whatsappConfigured ? "live" : "demo", detail: whatsappReady ? "Credenciales presentes" : "Faltan Phone Number ID y/o Access Token" },
          email: { status: emailConfigured ? "connected" : "pending", mode: emailConfigured ? "live" : "demo", from: emailConfigured ? emailFrom : null, detail: emailConfigured ? "Servidor de email configurado" : "Falta RESEND_API_KEY / EMAIL_FROM en el servidor" },
          sms: { status: "off", mode: "demo", detail: "Sin proveedor de SMS integrado" },
        },
        errors: null,
      });
    },
  );

  // POST /tenants/me/channels/:channel/test — "Probar conexión".
  server.post<{ Params: { channel: string } }>(
    "/tenants/me/channels/:channel/test",
    { preHandler: [requireRole("ADMIN"), requireFeature("channels")] },
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
    { preHandler: [requireRole("ADMIN"), requireFeature("api_public")] },
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
    { preHandler: [requireRole("ADMIN"), requireFeature("api_public")] },
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
    { preHandler: [requireRole("ADMIN"), requireFeature("api_public")] },
    async (request, reply: FastifyReply) => {
      await prisma.apiKey.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: { revokedAt: new Date() },
      });
      return reply.status(204).send();
    },
  );
}
