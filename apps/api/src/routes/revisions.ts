import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { generatePdf, ensureRevisionPdf } from "../lib/pdf.js";

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

  // GET /revisions/:id
  server.get<{ Params: { id: string } }>("/revisions/:id", { preHandler: [requireRole("DOCTOR")] },
    async (request, reply: FastifyReply) => {
      const revision = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
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

      // Calculate expiry date from product renewal rules
      let expiryDate: Date | null = null;
      const renewalRules = existing.appointment.product.renewalRules as { validityDays?: number } | null;
      if (renewalRules?.validityDays) {
        expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + renewalRules.validityDays);
      }

      const updated = await prisma.revision.update({
        where: { id: request.params.id },
        data: {
          formData: body.data.formData as any,
          outcome: body.data.outcome,
          notes: body.data.notes ?? null,
          completedAt: new Date(),
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
  server.get<{ Params: { id: string } }>("/revisions/:id/pdf", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      try {
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
}
