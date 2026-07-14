import type { FastifyReply, FastifyRequest } from "fastify";

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
