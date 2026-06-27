import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { hashPassword } from "../lib/password.js";
import { auditLog } from "../lib/audit.js";

// Roles que un admin puede asignar (SUPERADMIN no se gestiona desde aquí).
const ASSIGNABLE_ROLES = ["ADMIN", "RECEPTIONIST", "DOCTOR"] as const;

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  role: z.enum(ASSIGNABLE_ROLES),
  centerId: z.string().uuid().nullable().optional(),
  password: z.string().min(8).max(100),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  centerId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
});

const userSelect = {
  id: true, email: true, firstName: true, lastName: true, role: true,
  centerId: true, active: true, createdAt: true,
  center: { select: { id: true, name: true } },
};

export async function userRoutes(server: FastifyInstance) {
  // GET /users — equipo del tenant
  server.get("/users", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await prisma.user.findMany({
        where: { tenantId: request.ctx.tenantId },
        select: userSelect,
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      });
      return reply.send({ data: users, errors: null });
    });

  // POST /users — alta de usuario
  server.post("/users", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createUserSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.user.findFirst({ where: { tenantId: request.ctx.tenantId, email: body.data.email } });
      if (existing) return reply.status(409).send({ errors: [{ code: "EMAIL_TAKEN", message: "Ese email ya está en uso" }] });

      if (body.data.centerId) {
        const center = await prisma.center.findFirst({ where: { id: body.data.centerId, tenantId: request.ctx.tenantId } });
        if (!center) return reply.status(400).send({ errors: [{ code: "INVALID_CENTER" }] });
      }

      const user = await prisma.user.create({
        data: {
          tenantId: request.ctx.tenantId,
          email: body.data.email,
          firstName: body.data.firstName,
          lastName: body.data.lastName,
          role: body.data.role,
          centerId: body.data.centerId ?? null,
          passwordHash: await hashPassword(body.data.password),
        },
        select: userSelect,
      });
      await auditLog({ tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip }, "CREATE", "user", user.id, { after: { email: user.email, role: user.role } });
      return reply.status(201).send({ data: user, errors: null });
    });

  // PATCH /users/:id — editar
  server.patch<{ Params: { id: string } }>("/users/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = updateUserSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const target = await prisma.user.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!target) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      if (body.data.centerId) {
        const center = await prisma.center.findFirst({ where: { id: body.data.centerId, tenantId: request.ctx.tenantId } });
        if (!center) return reply.status(400).send({ errors: [{ code: "INVALID_CENTER" }] });
      }
      // No permitir auto-desactivarse (evita quedarse sin acceso)
      if (request.params.id === request.ctx.userId && body.data.active === false) {
        return reply.status(400).send({ errors: [{ code: "CANNOT_DEACTIVATE_SELF", message: "No puedes desactivar tu propia cuenta" }] });
      }

      const data: Record<string, unknown> = {};
      if (body.data.firstName !== undefined) data["firstName"] = body.data.firstName;
      if (body.data.lastName !== undefined) data["lastName"] = body.data.lastName;
      if (body.data.role !== undefined) data["role"] = body.data.role;
      if (body.data.centerId !== undefined) data["centerId"] = body.data.centerId;
      if (body.data.active !== undefined) data["active"] = body.data.active;
      if (body.data.password) data["passwordHash"] = await hashPassword(body.data.password);

      await prisma.user.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data });
      await auditLog({ tenantId: request.ctx.tenantId, userId: request.ctx.userId, ip: request.ip }, "UPDATE", "user", request.params.id, { after: { fields: Object.keys(data) } });
      return reply.send({ data: { updated: true }, errors: null });
    });

  // DELETE /users/:id — desactivar (soft)
  server.delete<{ Params: { id: string } }>("/users/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      if (request.params.id === request.ctx.userId) {
        return reply.status(400).send({ errors: [{ code: "CANNOT_DELETE_SELF", message: "No puedes eliminar tu propia cuenta" }] });
      }
      await prisma.user.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: { active: false } });
      return reply.status(204).send();
    });
}
