import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { effectivePlan, hasFeature, FEATURES, type FeatureKey, type PlanInput } from "./plan.js";

export type UserRole = "SUPERADMIN" | "ADMIN" | "RECEPTIONIST" | "DOCTOR" | "API_KEY";

const ROLE_RANK: Record<UserRole, number> = {
  SUPERADMIN: 100,
  ADMIN: 80,
  RECEPTIONIST: 40,
  DOCTOR: 30,
  API_KEY: 10,
};

// Conjuntos de roles explícitos para casos donde el rango lineal no encaja
// (RECEPTIONIST y DOCTOR son paralelos, no jerárquicos). SUPERADMIN se admite
// siempre en requireAnyRole (dueño de plataforma que "actúa como" empresa).
export const ROLES_CLINICAL: UserRole[] = ["ADMIN", "DOCTOR"]; // acto clínico: crear/editar/firmar revisión
export const ROLES_STAFF: UserRole[] = ["ADMIN", "RECEPTIONIST", "DOCTOR"]; // cualquier personal (lectura operativa)
export const ROLES_DOCTOR: UserRole[] = ["DOCTOR"]; // cabina de Consulta: exclusiva del médico

/**
 * preHandler que exige pertenecer a un conjunto explícito de roles (SUPERADMIN
 * siempre permitido). Úsalo cuando el mínimo por rango no separa bien RECEPCIÓN
 * y MÉDICO. Usage: { preHandler: [requireAnyRole(ROLES_CLINICAL)] }
 */
export function requireAnyRole(roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx;
    if (!ctx) return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED", message: "No autenticado" }] });
    if (ctx.role === "SUPERADMIN" || roles.includes(ctx.role as UserRole)) return;
    return reply.status(403).send({ errors: [{ code: "FORBIDDEN", message: "Sin permisos suficientes" }] });
  };
}

/**
 * Returns a Fastify preHandler that enforces minimum role.
 * Usage: { preHandler: [requireRole("ADMIN")] }
 */
export function requireRole(minRole: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED", message: "No autenticado" }] });
    }
    const userRank = ROLE_RANK[ctx.role as UserRole] ?? 0;
    const requiredRank = ROLE_RANK[minRole] ?? 999;
    if (userRank < requiredRank) {
      return reply.status(403).send({ errors: [{ code: "FORBIDDEN", message: "Sin permisos suficientes" }] });
    }
  };
}

// ── Planes (crm-planes) ─────────────────────────────────────────────────────
// Caché corta del plan por empresa para no leer el tenant en cada petición.
const PLAN_TTL_MS = 60_000;
const planCache = new Map<string, { at: number; t: PlanInput }>();

export async function tenantPlan(tenantId: string): Promise<PlanInput | null> {
  const hit = planCache.get(tenantId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.t;
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, trialUntil: true, featureOverrides: true } });
  if (!t) return null;
  planCache.set(tenantId, { at: Date.now(), t });
  return t;
}

// Llamar al cambiar plan/prueba/excepciones desde el panel de proveedor.
export function invalidatePlanCache(tenantId?: string): void {
  if (tenantId) planCache.delete(tenantId); else planCache.clear();
}

/**
 * preHandler que exige que la empresa del contexto tenga una función del plan.
 * El SUPERADMIN actuando como empresa NO está exento (ve lo mismo que ella).
 * Usage: { preHandler: [requireRole("ADMIN"), requireFeature("campaigns")] }
 */
// "Ver como Pro" (D9): vista previa solo para el SUPERADMIN, vía cabecera; no
// cambia el plan ni se persiste. Una clínica no puede usarla (se ignora el rol).
export function isProPreview(request: FastifyRequest): boolean {
  return request.ctx?.role === "SUPERADMIN" && request.headers["x-preview-plan"] === "PRO";
}

export function requireFeature(key: FeatureKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx;
    if (!ctx) return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED", message: "No autenticado" }] });
    if (isProPreview(request)) return;
    const t = await tenantPlan(ctx.tenantId);
    if (!t || !hasFeature(t, key)) {
      return reply.status(403).send({
        errors: [{ code: "FEATURE_NOT_IN_PLAN", message: `"${FEATURES[key].label}" no está incluido en tu plan`, feature: key, plan: t ? effectivePlan(t) : null }],
      });
    }
  };
}

/**
 * Ensures the request tenant matches target tenant (or requester is SUPERADMIN).
 */
export function requireSameTenant(targetTenantId: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED" }] });
    }
    if (ctx.role !== "SUPERADMIN" && ctx.tenantId !== targetTenantId) {
      return reply.status(403).send({ errors: [{ code: "FORBIDDEN", message: "Acceso denegado" }] });
    }
  };
}
