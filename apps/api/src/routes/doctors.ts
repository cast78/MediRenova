import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { hashPassword } from "../lib/password.js";
import { storage, sanitizeFileName } from "../lib/storage.js";

const SIGNATURE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const createDoctorSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  dni: z.string().max(20).optional(),
  licenseNumber: z.string().max(40).optional(),
  centerIds: z.array(z.string().uuid()).max(50).optional(),
  password: z.string().min(8).max(100),
});

const updateDoctorSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  dni: z.string().max(20).nullable().optional(),
  licenseNumber: z.string().max(40).nullable().optional(),
  centerIds: z.array(z.string().uuid()).max(50).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
});

const doctorSelect = {
  id: true, email: true, firstName: true, lastName: true,
  dni: true, licenseNumber: true, signatureKey: true, active: true,
  assignedCenters: { select: { center: { select: { id: true, name: true } } } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shape(u: any) {
  const { assignedCenters, signatureKey, ...rest } = u;
  return { ...rest, hasSignature: !!signatureKey, centers: assignedCenters.map((a: { center: unknown }) => a.center) };
}

async function centersValid(tenantId: string, centerIds: string[] | undefined): Promise<boolean> {
  if (!centerIds || centerIds.length === 0) return true;
  const count = await prisma.center.count({ where: { id: { in: centerIds }, tenantId } });
  return count === centerIds.length;
}

export async function doctorRoutes(server: FastifyInstance) {
  // GET /doctors — listado de médicos del tenant
  server.get("/doctors", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const doctors = await prisma.user.findMany({
        where: { tenantId: request.ctx.tenantId, role: "DOCTOR" },
        select: doctorSelect,
        orderBy: [{ active: "desc" }, { firstName: "asc" }],
      });
      return reply.send({ data: doctors.map(shape), errors: null });
    });

  // POST /doctors — alta de médico
  server.post("/doctors", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createDoctorSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.user.findFirst({ where: { tenantId: request.ctx.tenantId, email: body.data.email } });
      if (existing) return reply.status(409).send({ errors: [{ code: "EMAIL_TAKEN", message: "Ese email ya está en uso" }] });
      if (!(await centersValid(request.ctx.tenantId, body.data.centerIds))) {
        return reply.status(400).send({ errors: [{ code: "INVALID_CENTER" }] });
      }

      const doctor = await prisma.user.create({
        data: {
          tenantId: request.ctx.tenantId,
          email: body.data.email,
          firstName: body.data.firstName,
          lastName: body.data.lastName,
          role: "DOCTOR",
          dni: body.data.dni ?? null,
          licenseNumber: body.data.licenseNumber ?? null,
          passwordHash: await hashPassword(body.data.password),
          assignedCenters: { create: (body.data.centerIds ?? []).map((centerId) => ({ centerId })) },
        },
        select: doctorSelect,
      });
      return reply.status(201).send({ data: shape(doctor), errors: null });
    });

  // PATCH /doctors/:id
  server.patch<{ Params: { id: string } }>("/doctors/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = updateDoctorSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const target = await prisma.user.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId, role: "DOCTOR" } });
      if (!target) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      if (!(await centersValid(request.ctx.tenantId, body.data.centerIds))) {
        return reply.status(400).send({ errors: [{ code: "INVALID_CENTER" }] });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = {};
      if (body.data.firstName !== undefined) data["firstName"] = body.data.firstName;
      if (body.data.lastName !== undefined) data["lastName"] = body.data.lastName;
      if (body.data.dni !== undefined) data["dni"] = body.data.dni;
      if (body.data.licenseNumber !== undefined) data["licenseNumber"] = body.data.licenseNumber;
      if (body.data.active !== undefined) data["active"] = body.data.active;
      if (body.data.password) data["passwordHash"] = await hashPassword(body.data.password);
      if (body.data.centerIds !== undefined) {
        data["assignedCenters"] = { deleteMany: {}, create: body.data.centerIds.map((centerId) => ({ centerId })) };
      }

      const doctor = await prisma.user.update({ where: { id: request.params.id }, data, select: doctorSelect });
      return reply.send({ data: shape(doctor), errors: null });
    });

  // POST /doctors/:id/signature — sube la firma del médico
  server.post<{ Params: { id: string } }>("/doctors/:id/signature", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const target = await prisma.user.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId, role: "DOCTOR" } });
      if (!target) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const file = await request.file();
      if (!file) return reply.status(400).send({ errors: [{ code: "NO_FILE" }] });
      if (!SIGNATURE_MIME.has(file.mimetype)) return reply.status(400).send({ errors: [{ code: "INVALID_FILE_TYPE", message: "Solo PNG, JPG o WEBP" }] });
      const buffer = await file.toBuffer();
      if (file.file.truncated) return reply.status(413).send({ errors: [{ code: "FILE_TOO_LARGE" }] });

      const ext = sanitizeFileName(file.filename || "firma.png");
      const key = `tenants/${request.ctx.tenantId}/doctors/${request.params.id}/signature-${randomUUID()}-${ext}`;
      await storage.put(key, buffer, file.mimetype);
      await prisma.user.update({ where: { id: request.params.id }, data: { signatureKey: key } });
      return reply.status(201).send({ data: { hasSignature: true }, errors: null });
    });

  // GET /doctors/:id/signature — sirve la firma
  server.get<{ Params: { id: string } }>("/doctors/:id/signature", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const doctor = await prisma.user.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId, role: "DOCTOR" }, select: { signatureKey: true } });
      if (!doctor?.signatureKey) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      try {
        const bytes = await storage.get(doctor.signatureKey);
        return reply.header("Content-Type", "image/png").header("Content-Disposition", "inline").send(bytes);
      } catch {
        return reply.status(404).send({ errors: [{ code: "FILE_NOT_FOUND" }] });
      }
    });

  // DELETE /doctors/:id/signature
  server.delete<{ Params: { id: string } }>("/doctors/:id/signature", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.user.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId, role: "DOCTOR" }, data: { signatureKey: null } });
      return reply.status(204).send();
    });
}
