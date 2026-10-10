// Panel de proveedor (crm-planes P4): gestión de empresas y licencias por el
// SUPERADMIN, por encima de todas las clínicas. Las consultas cruzadas pasan
// `tenantId: { in: ids }` explícitamente: así la extensión de aislamiento no
// inyecta el tenant del contexto (ver withTenantFilter).
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { hash } from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireRole, invalidatePlanCache } from "../lib/authorization.js";
import { auditLog } from "../lib/audit.js";
import { effectivePlan, features, validateOverrides, FEATURES, FEATURE_KEYS, type PlanInput } from "../lib/plan.js";

const DAY_MS = 86_400_000;

// Umbrales de "candidata a Pro" (Esencial con volumen que el CRM aprovecharía).
export const PRO_CANDIDATE = { noShows30d: 5, appointments30d: 80 };

function trialDaysLeft(trialUntil: Date | null, now = new Date()): number | null {
  if (!trialUntil || trialUntil.getTime() <= now.getTime()) return null;
  return Math.ceil((trialUntil.getTime() - now.getTime()) / DAY_MS);
}

type CountRow = { tenantId: string; _count: { _all: number } };
const toMap = (rows: CountRow[]) => new Map(rows.map((r) => [r.tenantId, r._count._all]));

const TENANT_SELECT = {
  id: true, name: true, slug: true, active: true, plan: true, trialUntil: true, featureOverrides: true, maxCenters: true, createdAt: true,
  config: { select: { timezone: true, primaryColor: true } },
  _count: { select: { users: true, customers: true } },
  // Primer admin de la empresa (para búsqueda y contacto desde el panel).
  users: { where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true, firstName: true, lastName: true } },
} satisfies Prisma.TenantSelect;

const CATALOG = FEATURE_KEYS.map((k) => ({ key: k, label: FEATURES[k].label, min: FEATURES[k].min, requires: FEATURES[k].requires ?? [] }));

// Citas por mes (fecha de la cita) de los últimos 6 meses, por empresa:
// Map<tenantId, number[6]> en orden cronológico. SQL crudo porque Prisma no
// agrupa por mes; `tenantId` explícito en el WHERE, como el resto del panel.
async function monthlyAppointments(ids: string[], now = new Date()): Promise<Map<string, number[]>> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const out = new Map<string, number[]>(ids.map((id) => [id, [0, 0, 0, 0, 0, 0]]));
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw<{ tenant_id: string; m: Date; n: bigint }[]>(Prisma.sql`
    SELECT tenant_id, date_trunc('month', scheduled_at) AS m, count(*)::bigint AS n
    FROM appointments
    WHERE tenant_id IN (${Prisma.join(ids)}) AND scheduled_at >= ${start}
    GROUP BY 1, 2`);
  for (const r of rows) {
    const idx = (r.m.getUTCFullYear() - start.getUTCFullYear()) * 12 + (r.m.getUTCMonth() - start.getUTCMonth());
    const arr = out.get(r.tenant_id);
    if (arr && idx >= 0 && idx < 6) arr[idx] = Number(r.n);
  }
  return out;
}

export async function superadminRoutes(server: FastifyInstance) {
  const guard = { preHandler: [requireRole("SUPERADMIN")] };

  // GET /superadmin/tenants — lista de empresas con licencia, actividad y señales.
  server.get("/superadmin/tenants", guard, async (_request: FastifyRequest, reply: FastifyReply) => {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const tenants = await prisma.tenant.findMany({ where: { slug: { not: "system" } }, orderBy: { createdAt: "asc" }, select: TENANT_SELECT });
    const ids = tenants.map((t) => t.id);
    const [centers, appts, noShows, lastAppt, openReqs, monthly] = await Promise.all([
      prisma.center.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, active: true }, _count: { _all: true } }),
      prisma.appointment.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.appointment.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, status: "NO_SHOW", scheduledAt: { gte: since } }, _count: { _all: true } }),
      prisma.appointment.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
      prisma.planRequest.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, status: "OPEN" }, _count: { _all: true } }),
      monthlyAppointments(ids, now),
    ]);
    const cMap = toMap(centers), aMap = toMap(appts), nMap = toMap(noShows), rMap = toMap(openReqs);
    const lastMap = new Map(lastAppt.map((r) => [r.tenantId, r._max.createdAt]));

    const rows = tenants.map((t) => {
      const eff = effectivePlan(t, now);
      const appointments30d = aMap.get(t.id) ?? 0;
      const noShows30d = nMap.get(t.id) ?? 0;
      const lastActivityAt = lastMap.get(t.id) ?? null;
      const candidate = t.plan === "ESSENTIAL" && eff === "ESSENTIAL" && (noShows30d >= PRO_CANDIDATE.noShows30d || appointments30d >= PRO_CANDIDATE.appointments30d);
      const inactive = !lastActivityAt || lastActivityAt.getTime() < since.getTime();
      const { _count, config, users, ...rest } = t;
      const admin = users[0] ?? null;
      return {
        ...rest,
        timezone: config?.timezone ?? null,
        admin: admin ? { email: admin.email, name: `${admin.firstName} ${admin.lastName}`.trim() } : null,
        effectivePlan: eff,
        trialDaysLeft: trialDaysLeft(t.trialUntil, now),
        centersCount: cMap.get(t.id) ?? 0,
        usersCount: _count.users,
        customersCount: _count.customers,
        appointments30d, noShows30d, lastActivityAt,
        monthly: monthly.get(t.id) ?? [0, 0, 0, 0, 0, 0],
        openRequests: rMap.get(t.id) ?? 0,
        candidate, inactive,
      };
    });
    const meta = {
      total: rows.length,
      byPlan: { ESSENTIAL: rows.filter((r) => r.effectivePlan === "ESSENTIAL").length, PRO: rows.filter((r) => r.effectivePlan === "PRO").length },
      trials: rows.filter((r) => r.trialDaysLeft != null).length,
      trialsEndingSoon: rows.filter((r) => r.trialDaysLeft != null && r.trialDaysLeft <= 7).length,
      openRequests: rows.reduce((s, r) => s + r.openRequests, 0),
      candidates: rows.filter((r) => r.candidate).length,
      inactive: rows.filter((r) => r.inactive).length,
      centers: rows.reduce((s, r) => s + r.centersCount, 0),
      thresholds: PRO_CANDIDATE,
      catalog: CATALOG,
      months: Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)); return d.toISOString().slice(0, 7); }),
    };
    return reply.send({ data: rows, meta, errors: null });
  });

  // POST /superadmin/tenants — alta de empresa con su admin inicial.
  server.post("/superadmin/tenants", guard, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({
      name: z.string().min(2).max(100),
      slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
      timezone: z.string().optional(),
      primaryColor: z.string().optional(),
      plan: z.enum(["ESSENTIAL", "PRO"]).default("ESSENTIAL"),
      trialUntil: z.string().datetime().nullable().optional(),
      maxCenters: z.number().int().min(1).nullable().optional(),
      admin: z.object({ email: z.string().email(), firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(80), password: z.string().min(8).max(100) }),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
    const d = body.data;
    if (await prisma.tenant.findUnique({ where: { slug: d.slug } })) return reply.status(409).send({ errors: [{ code: "SLUG_TAKEN", message: "Slug ya en uso" }] });

    const passwordHash = await hash(d.admin.password, 12);
    const tenant = await prisma.tenant.create({
      data: {
        name: d.name, slug: d.slug, plan: d.plan,
        trialUntil: d.trialUntil ? new Date(d.trialUntil) : null,
        maxCenters: d.maxCenters ?? null,
        config: { create: { primaryColor: d.primaryColor ?? "#2563eb", timezone: d.timezone ?? "Europe/Madrid" } },
        users: { create: { email: d.admin.email, firstName: d.admin.firstName, lastName: d.admin.lastName, passwordHash, role: "ADMIN" } },
      },
      select: { id: true, name: true, slug: true, plan: true, trialUntil: true },
    });
    await auditLog({ tenantId: tenant.id, userId: request.ctx.userId, ip: request.ip }, "CREATE", "tenant_plan", tenant.id, { plan: d.plan, trialUntil: d.trialUntil ?? null, admin: d.admin.email });
    return reply.status(201).send({ data: { ...tenant, admin: { email: d.admin.email } }, errors: null });
  });

  // GET /superadmin/tenants/:id — ficha: licencia, funciones resueltas, historial y peticiones.
  server.get<{ Params: { id: string } }>("/superadmin/tenants/:id", guard, async (request, reply: FastifyReply) => {
    const t = await prisma.tenant.findUnique({ where: { id: request.params.id }, select: TENANT_SELECT });
    if (!t) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [centers, history, requests, usersList, monthly, appts30, noShows30, lastAppt] = await Promise.all([
      prisma.center.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, city: true, active: true }, orderBy: { name: "asc" } }),
      prisma.auditLog.findMany({ where: { tenantId: t.id, resourceType: "tenant_plan" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, meta: true, createdAt: true, user: { select: { email: true, firstName: true, lastName: true } } } }),
      prisma.planRequest.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.user.findMany({ where: { tenantId: t.id }, select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
      monthlyAppointments([t.id], now),
      prisma.appointment.count({ where: { tenantId: t.id, createdAt: { gte: since } } }),
      prisma.appointment.count({ where: { tenantId: t.id, status: "NO_SHOW", scheduledAt: { gte: since } } }),
      prisma.appointment.findFirst({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const { _count, config, users, ...rest } = t;
    const eff = effectivePlan(t, now);
    return reply.send({
      data: {
        ...rest, timezone: config?.timezone ?? null, primaryColor: config?.primaryColor ?? null,
        admin: users[0] ? { email: users[0].email, name: `${users[0].firstName} ${users[0].lastName}`.trim() } : null,
        effectivePlan: eff, trialDaysLeft: trialDaysLeft(t.trialUntil, now), features: features(t, now),
        catalog: CATALOG,
        usersCount: _count.users, customersCount: _count.customers, centers, history, requests, users: usersList,
        activity: {
          monthly: monthly.get(t.id) ?? [0, 0, 0, 0, 0, 0],
          months: Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)); return d.toISOString().slice(0, 7); }),
          appointments30d: appts30, noShows30d: noShows30, lastActivityAt: lastAppt?.createdAt ?? null,
          candidate: t.plan === "ESSENTIAL" && eff === "ESSENTIAL" && (noShows30 >= PRO_CANDIDATE.noShows30d || appts30 >= PRO_CANDIDATE.appointments30d),
          thresholds: PRO_CANDIDATE,
        },
      },
      errors: null,
    });
  });

  // PATCH /superadmin/tenants/:id — plan, prueba, excepciones, límite de centros, activa.
  server.patch<{ Params: { id: string } }>("/superadmin/tenants/:id", guard, async (request, reply: FastifyReply) => {
    const body = z.object({
      plan: z.enum(["ESSENTIAL", "PRO"]).optional(),
      trialUntil: z.string().datetime().nullable().optional(),
      featureOverrides: z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }).nullable().optional(),
      maxCenters: z.number().int().min(1).nullable().optional(),
      active: z.boolean().optional(),
      reason: z.string().max(300).optional(),
      // Al pasar a Pro desde el diálogo de confirmación: cierra la petición abierta.
      closeOpenRequests: z.boolean().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
    const d = body.data;
    if (d.featureOverrides !== undefined && d.featureOverrides !== null) {
      const errs = validateOverrides(d.featureOverrides);
      if (errs.length) return reply.status(400).send({ errors: errs.map((message) => ({ code: "INVALID_OVERRIDES", message })) });
    }
    const before = await prisma.tenant.findUnique({ where: { id: request.params.id }, select: { plan: true, trialUntil: true, featureOverrides: true, maxCenters: true, active: true } });
    if (!before) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

    const data: Prisma.TenantUpdateInput = {};
    if (d.plan !== undefined) data.plan = d.plan;
    if (d.trialUntil !== undefined) data.trialUntil = d.trialUntil ? new Date(d.trialUntil) : null;
    if (d.featureOverrides !== undefined) data.featureOverrides = d.featureOverrides === null ? Prisma.JsonNull : d.featureOverrides;
    if (d.maxCenters !== undefined) data.maxCenters = d.maxCenters;
    if (d.active !== undefined) data.active = d.active;
    const after = await prisma.tenant.update({ where: { id: request.params.id }, data, select: { plan: true, trialUntil: true, featureOverrides: true, maxCenters: true, active: true } });
    invalidatePlanCache(request.params.id);
    if (d.closeOpenRequests) {
      await prisma.planRequest.updateMany({
        where: { tenantId: request.params.id, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date(), ...(d.reason ? { note: `Cierre: ${d.reason}` } : {}) },
      });
    }
    await auditLog({ tenantId: request.params.id, userId: request.ctx.userId, ip: request.ip }, "UPDATE", "tenant_plan", request.params.id, { before, after, reason: d.reason ?? null });
    const input: PlanInput = after;
    return reply.send({ data: { ...after, effectivePlan: effectivePlan(input), features: features(input) }, errors: null });
  });

  // GET /superadmin/plan-requests?status=OPEN|CLOSED — bandeja de peticiones "Quiero pasar a Pro".
  server.get("/superadmin/plan-requests", guard, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = z.object({ status: z.enum(["OPEN", "CLOSED"]).optional() }).safeParse(request.query);
    const status = q.success ? q.data.status : undefined;
    const rows = await prisma.planRequest.findMany({
      where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, tenantId: true, requestedPlan: true, byUserId: true, note: true, status: true, createdAt: true, closedAt: true, tenant: { select: { name: true, slug: true, plan: true } } },
    });
    const userIds = [...new Set(rows.map((r) => r.byUserId).filter((x): x is string => !!x))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds }, tenantId: { in: rows.map((r) => r.tenantId) } }, select: { id: true, email: true, firstName: true, lastName: true } })
      : [];
    const uMap = new Map(users.map((u) => [u.id, u]));
    return reply.send({ data: rows.map((r) => ({ ...r, byUser: r.byUserId ? uMap.get(r.byUserId) ?? null : null })), errors: null });
  });

  // PATCH /superadmin/plan-requests/:id — cerrar (con nota opcional) o reabrir.
  server.patch<{ Params: { id: string } }>("/superadmin/plan-requests/:id", guard, async (request, reply: FastifyReply) => {
    const body = z.object({ status: z.enum(["OPEN", "CLOSED"]), note: z.string().max(500).optional() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
    const existing = await prisma.planRequest.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
    const note = body.data.note ? [existing.note, `Cierre: ${body.data.note}`].filter(Boolean).join(" · ") : existing.note;
    const updated = await prisma.planRequest.update({
      where: { id: existing.id },
      data: { status: body.data.status, closedAt: body.data.status === "CLOSED" ? new Date() : null, note },
    });
    return reply.send({ data: updated, errors: null });
  });
}
