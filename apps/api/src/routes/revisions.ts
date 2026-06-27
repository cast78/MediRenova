import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { randomUUID } from "node:crypto";
import { generatePdf, ensureRevisionPdf } from "../lib/pdf.js";
import { calculateExpiryDate, type RenewalRules } from "../lib/expiry.js";
import { storage, sanitizeFileName } from "../lib/storage.js";

const ALLOWED_ATTACHMENT_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const revisionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  outcome: z.enum(["PENDING", "APTO", "NO_APTO"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function revisionRoutes(server: FastifyInstance) {
  // POST /revisions — create from appointment
  server.post("/revisions", { preHandler: [requireRole("DOCTOR")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ appointmentId: z.string().uuid() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const appointment = await prisma.appointment.findFirst({
        where: { id: body.data.appointmentId, tenantId: request.ctx.tenantId, status: { in: ["CONFIRMED", "PENDING"] } },
        include: { product: { include: { formTemplates: { where: { isActive: true }, take: 1 } } } },
      });
      if (!appointment) return reply.status(404).send({ errors: [{ code: "APPOINTMENT_NOT_FOUND" }] });

      const existingRevision = await prisma.revision.findUnique({ where: { appointmentId: body.data.appointmentId } });
      if (existingRevision) return reply.status(409).send({ data: existingRevision, errors: null });

      const formTemplate = appointment.product.formTemplates[0];

      // If no active form template, create a minimal blank one on-the-fly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolvedTemplate = formTemplate ?? await prisma.formTemplate.create({
        data: {
          productId: appointment.productId,
          name: `Formulario ${appointment.product.name}`,
          version: 1,
          schema: { fields: [] },
          isActive: true,
          createdById: request.ctx.userId,
        } as any,
      });

      const revision = await prisma.revision.create({
        data: {
          tenantId: request.ctx.tenantId,
          appointmentId: body.data.appointmentId,
          customerId: appointment.customerId,
          productId: appointment.productId,
          roomId: appointment.roomId,
          doctorId: request.ctx.userId,
          formTemplateId: resolvedTemplate.id,
          formData: {},
          outcome: "PENDING",
          startedAt: new Date(),
        },
      });

      await prisma.appointment.update({ where: { id: body.data.appointmentId }, data: { status: "CONFIRMED" } });

      return reply.status(201).send({ data: revision, errors: null });
    });

  // GET /revisions — listado paginado con filtros (estado, fecha de la cita)
  server.get("/revisions", { preHandler: [requireRole("DOCTOR")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = revisionListQuery.safeParse(request.query);
      if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });
      const { page, limit, outcome, date } = q.data;

      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId };
      if (outcome) where["outcome"] = outcome;
      const apptFilter: Record<string, unknown> = {};
      if (date) {
        const d = new Date(`${date}T00:00:00.000Z`);
        apptFilter["scheduledAt"] = { gte: d, lte: new Date(d.getTime() + 86_400_000) };
      }
      if (request.ctx.centerId) apptFilter["room"] = { centerId: request.ctx.centerId };
      if (Object.keys(apptFilter).length) where["appointment"] = apptFilter;

      const [items, total] = await Promise.all([
        prisma.revision.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            appointment: {
              include: {
                customer: { select: { id: true, firstName: true, lastName: true } },
                product: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.revision.count({ where }),
      ]);

      return reply.send({ data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) }, errors: null });
    });

  // GET /revisions/:id
  server.get<{ Params: { id: string } }>("/revisions/:id", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const revision = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, ...(request.ctx.centerId ? { appointment: { room: { centerId: request.ctx.centerId } } } : {}) },
        include: {
          formTemplate: true,
          attachments: true,
          appointment: { include: { customer: true, product: true } },
        },
      });
      if (!revision) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: revision, errors: null });
    });

  // PATCH /revisions/:id — save partial form data
  server.patch<{ Params: { id: string } }>("/revisions/:id", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const body = z.object({ formData: z.record(z.unknown()) }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, outcome: "PENDING" },
      });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND_OR_COMPLETED" }] });

      const updated = await prisma.revision.update({
        where: { id: request.params.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { formData: body.data.formData as any },
      });
      return reply.send({ data: updated, errors: null });
    });

  // POST /revisions/:id/complete — finalize revision
  server.post<{ Params: { id: string } }>("/revisions/:id/complete", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const body = z.object({
        formData: z.record(z.unknown()),
        outcome: z.enum(["APTO", "NO_APTO"]),
        notes: z.string().optional(),
      }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, outcome: "PENDING" },
        include: { formTemplate: true, appointment: { include: { product: true, customer: true } } },
      });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND_OR_COMPLETED" }] });

      // Caducidad según reglas de renovación del producto (tramos por edad o
      // validez simple). Solo se fija si el dictamen es APTO.
      const completedAt = new Date();
      const expiryDate =
        body.data.outcome === "APTO"
          ? calculateExpiryDate(
              existing.appointment.customer.birthDate,
              completedAt,
              existing.appointment.product.renewalRules as RenewalRules | null,
            )
          : null;

      const updated = await prisma.revision.update({
        where: { id: request.params.id },
        data: {
          formData: body.data.formData as any,
          outcome: body.data.outcome,
          notes: body.data.notes ?? null,
          completedAt,
          expiryDate,
        },
      });

      // Appointment stays CONFIRMED after revision completion
      // (no separate COMPLETED status in the enum)

      // Generación de PDF best-effort: no bloquea la respuesta ni rompe el flujo
      // si Puppeteer/Chromium fallara (se puede regenerar al pedir el PDF).
      generatePdf(request.params.id).catch((err) => {
        request.log.error(err, "[pdf] background generation failed");
      });

      return reply.send({ data: updated, errors: null });
    });

  // GET /revisions/:id/pdf — genera (si falta) y sirve el certificado en PDF
  server.get<{ Params: { id: string } }>("/revisions/:id/pdf", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      try {
        if (request.ctx.centerId) {
          const ok = await prisma.revision.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId, appointment: { room: { centerId: request.ctx.centerId } } }, select: { id: true } });
          if (!ok) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
        }
        const pdf = await ensureRevisionPdf(request.params.id, request.ctx.tenantId);
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `inline; filename="certificado-${request.params.id}.pdf"`)
          .send(pdf);
      } catch (err) {
        if (err instanceof Error && err.message === "REVISION_NOT_FOUND") {
          return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
        }
        request.log.error(err, "[pdf] error serving revision pdf");
        return reply.status(500).send({ errors: [{ code: "PDF_GENERATION_FAILED" }] });
      }
    });

  // POST /revisions/:id/attachments — sube una foto/PDF a storage (task 11.3)
  server.post<{ Params: { id: string }; Querystring: { fieldId?: string } }>(
    "/revisions/:id/attachments", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const revision = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
      });
      if (!revision) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const file = await request.file();
      if (!file) return reply.status(400).send({ errors: [{ code: "NO_FILE" }] });
      if (!ALLOWED_ATTACHMENT_MIME.has(file.mimetype)) {
        return reply.status(400).send({ errors: [{ code: "INVALID_FILE_TYPE", message: "Solo JPG, PNG, WEBP o PDF" }] });
      }

      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        return reply.status(413).send({ errors: [{ code: "FILE_TOO_LARGE", message: "Máximo 10 MB" }] });
      }

      const fileName = sanitizeFileName(file.filename || "archivo");
      const key = `tenants/${request.ctx.tenantId}/revisions/${request.params.id}/attachments/${randomUUID()}-${fileName}`;
      await storage.put(key, buffer, file.mimetype);

      const attachment = await prisma.revisionAttachment.create({
        data: {
          revisionId: request.params.id,
          fieldId: request.query.fieldId ?? "general",
          fileName,
          mimeType: file.mimetype,
          sizeBytes: buffer.length,
          r2Key: key,
        },
      });
      return reply.status(201).send({ data: attachment, errors: null });
    });

  // GET /revisions/:id/attachments/:attId — sirve el archivo adjunto
  server.get<{ Params: { id: string; attId: string } }>(
    "/revisions/:id/attachments/:attId", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const attachment = await prisma.revisionAttachment.findFirst({
        where: { id: request.params.attId, revision: { id: request.params.id, tenantId: request.ctx.tenantId } },
      });
      if (!attachment) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      try {
        const bytes = await storage.get(attachment.r2Key);
        return reply
          .header("Content-Type", attachment.mimeType)
          .header("Content-Disposition", `inline; filename="${attachment.fileName}"`)
          .send(bytes);
      } catch (err) {
        request.log.error(err, "[attachments] error serving file");
        return reply.status(404).send({ errors: [{ code: "FILE_NOT_FOUND" }] });
      }
    });

  // DELETE /revisions/:id/attachments/:attId
  server.delete<{ Params: { id: string; attId: string } }>(
    "/revisions/:id/attachments/:attId", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const attachment = await prisma.revisionAttachment.findFirst({
        where: { id: request.params.attId, revision: { id: request.params.id, tenantId: request.ctx.tenantId } },
      });
      if (!attachment) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      await prisma.revisionAttachment.delete({ where: { id: attachment.id } });
      return reply.status(204).send();
    });
}
