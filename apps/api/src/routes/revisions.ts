import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole, ROLES_CLINICAL, ROLES_STAFF } from "../lib/authorization.js";
import { randomUUID } from "node:crypto";
import { generatePdf, ensureRevisionPdf } from "../lib/pdf.js";
import { calculateExpiryDate, type RenewalRules } from "../lib/expiry.js";
import { storage, sanitizeFileName } from "../lib/storage.js";
import { missingForCompletion, type RevFieldDef } from "../lib/revision-validation.js";
import { DEFAULT_EXPLORATION_FORM } from "../lib/default-form.js";
import { hashDni } from "../lib/dni.js";
import { signMagicLinkToken } from "../lib/jwt.js";

const PUBLIC_URL = process.env["PUBLIC_URL"] ?? "http://localhost:3000";

const ALLOWED_ATTACHMENT_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const revisionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  outcome: z.enum(["PENDING", "APTO", "NO_APTO"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // rango de fechas (Historial)
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().min(1).max(100).optional(), // buscar por nombre o DNI del cliente
  expiringInDays: z.coerce.number().int().min(1).max(365).optional(), // vista "próximas a caducar"
  centerId: z.string().uuid().optional(), // filtro de centro (selector global del ADMIN)
  roomId: z.string().uuid().optional(),   // filtro de sala
  mine: z.coerce.boolean().optional(),    // solo las revisiones del médico en sesión (Pendientes)
});

// Filtro de sala/centro sobre la cita de la revisión. El centro FIJADO en el token
// (usuario BackOffice/Doctor) manda siempre: el query param solo aplica cuando el
// usuario no está atado a un centro (ADMIN con selector global). La sala acota más.
function apptRoomFilter(ctxCenterId: string | null | undefined, centerId?: string, roomId?: string): Record<string, unknown> | null {
  const effectiveCenter = ctxCenterId ?? centerId;
  const room: Record<string, unknown> = {};
  if (effectiveCenter) room["centerId"] = effectiveCenter;
  if (roomId) room["id"] = roomId;
  return Object.keys(room).length ? room : null;
}

export async function revisionRoutes(server: FastifyInstance) {
  // POST /revisions — create from appointment
  server.post("/revisions", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ appointmentId: z.string().uuid() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const appointment = await prisma.appointment.findFirst({
        where: { id: body.data.appointmentId, tenantId: request.ctx.tenantId, status: { in: ["CONFIRMED", "PENDING"] } },
        include: {
          product: { include: { formTemplates: { where: { isActive: true }, take: 1 } } },
          visit: { select: { id: true, status: true, startedAt: true, currentRoomId: true } },
        },
      });
      if (!appointment) return reply.status(404).send({ errors: [{ code: "APPOINTMENT_NOT_FOUND" }] });

      const existingRevision = await prisma.revision.findUnique({ where: { appointmentId: body.data.appointmentId } });
      if (existingRevision) return reply.status(409).send({ data: existingRevision, errors: null });

      const formTemplate = appointment.product.formTemplates[0];
      // ¿El formulario activo tiene campos? (el schema es Json → acceso defensivo)
      const activeFields = ((formTemplate?.schema as { fields?: unknown[] } | null)?.fields ?? []) as unknown[];

      // Si el producto no tiene formulario (o lo tiene vacío), se MATERIALIZA el
      // formulario por defecto del sistema → así ninguna revisión queda sin campos.
      // El producto queda con ese formulario (editable luego desde su configuración).
      let resolvedTemplate = formTemplate;
      if (activeFields.length === 0) {
        if (formTemplate) await prisma.formTemplate.update({ where: { id: formTemplate.id }, data: { isActive: false } });
        const latest = await prisma.formTemplate.findFirst({ where: { productId: appointment.productId }, orderBy: { version: "desc" }, select: { version: true } });
        resolvedTemplate = await prisma.formTemplate.create({
          data: {
            productId: appointment.productId,
            name: `Formulario ${appointment.product.name}`,
            version: (latest?.version ?? 0) + 1,
            schema: DEFAULT_EXPLORATION_FORM,
            isActive: true,
            createdById: request.ctx.userId,
          },
        });
      }
      if (!resolvedTemplate) return reply.status(500).send({ errors: [{ code: "FORM_TEMPLATE_ERROR" }] });

      const revision = await prisma.revision.create({
        data: {
          tenantId: request.ctx.tenantId,
          appointmentId: body.data.appointmentId,
          // Enlaza con la visita (episodio físico) si la cita ya tiene check-in.
          visitId: appointment.visit?.id ?? null,
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

      // Sincroniza la visita: al abrir la revisión pasa a "en sala" (IN_PROGRESS)
      // y se ubica en la sala de la cita si aún no estaba en ninguna.
      if (appointment.visit) {
        const visitData: Record<string, unknown> = {
          startedAt: appointment.visit.startedAt ?? new Date(),
          currentRoomId: appointment.visit.currentRoomId ?? appointment.roomId,
        };
        // Solo empuja a "en sala" si aún esperaba (no pisa estados terminales).
        if (appointment.visit.status === "WAITING") visitData["status"] = "IN_PROGRESS";
        await prisma.visit.update({ where: { id: appointment.visit.id }, data: visitData });
      }

      return reply.status(201).send({ data: revision, errors: null });
    });

  // GET /revisions — listado paginado con filtros (estado, fecha de la cita)
  server.get("/revisions", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = revisionListQuery.safeParse(request.query);
      if (!q.success) return reply.status(400).send({ errors: q.error.flatten().fieldErrors });
      const { page, limit, outcome, date, from, to, q: search, expiringInDays, centerId, roomId, mine } = q.data;

      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId };
      if (outcome) where["outcome"] = outcome;
      // "Mías": solo las revisiones de este médico (para Pendientes de cerrar). El
      // historial NO usa este filtro → así se ve la historia completa del paciente.
      if (mine) where["doctorId"] = request.ctx.userId;

      const apptFilter: Record<string, unknown> = {};
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) range["gte"] = new Date(`${from}T00:00:00.000Z`);
        if (to) range["lte"] = new Date(`${to}T23:59:59.999Z`);
        apptFilter["scheduledAt"] = range;
      } else if (date) {
        const d = new Date(`${date}T00:00:00.000Z`);
        apptFilter["scheduledAt"] = { gte: d, lte: new Date(d.getTime() + 86_400_000) };
      }
      const roomWhere = apptRoomFilter(request.ctx.centerId, centerId, roomId);
      if (roomWhere) apptFilter["room"] = roomWhere;
      // Búsqueda por nombre o DNI (hash) del cliente.
      if (search) {
        apptFilter["customer"] = {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { dniHash: hashDni(search) },
          ],
        };
      }
      if (Object.keys(apptFilter).length) where["appointment"] = apptFilter;

      // Vista "próximas a caducar": aptas cuya caducidad cae dentro de N días
      // (incluye ya vencidas, las más urgentes), ordenadas por caducidad ascendente.
      let orderBy: Record<string, "asc" | "desc"> = { createdAt: "desc" };
      if (expiringInDays !== undefined) {
        where["outcome"] = "APTO";
        where["expiryDate"] = { not: null, lte: new Date(Date.now() + expiringInDays * 86_400_000) };
        orderBy = { expiryDate: "asc" };
      }

      const [items, total] = await Promise.all([
        prisma.revision.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            appointment: {
              include: {
                customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, acceptsEmail: true, acceptsWhatsapp: true } },
                product: { select: { id: true, name: true } },
              },
            },
          },
          orderBy,
        }),
        prisma.revision.count({ where }),
      ]);

      // Avisos manuales de renovación por cliente+producto (para el indicador de la
      // campana en la fila). El producto se guarda en `detail` del evento.
      const custIds = [...new Set(items.map((r) => r.appointment.customer.id))];
      const avisoEvents = custIds.length
        ? await prisma.customerEvent.findMany({
            where: { tenantId: request.ctx.tenantId, customerId: { in: custIds }, type: "recordatorio_renovacion" },
            select: { customerId: true, detail: true, createdAt: true },
          })
        : [];
      const avisoBy = new Map<string, { count: number; last: Date }>();
      for (const e of avisoEvents) {
        const k = `${e.customerId}::${e.detail ?? ""}`;
        const cur = avisoBy.get(k);
        if (!cur) avisoBy.set(k, { count: 1, last: e.createdAt });
        else { cur.count += 1; if (e.createdAt > cur.last) cur.last = e.createdAt; }
      }
      const data = items.map((r) => {
        const a = avisoBy.get(`${r.appointment.customer.id}::${r.appointment.product.name}`);
        return { ...r, avisoCount: a?.count ?? 0, lastAvisoAt: a?.last ?? null };
      });

      return reply.send({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) }, errors: null });
    });

  // GET /revisions/stats — indicadores de cabecera (pendientes, caducan pronto, este mes)
  server.get("/revisions/stats", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.ctx.tenantId;
      const sq = z.object({ centerId: z.string().uuid().optional(), roomId: z.string().uuid().optional() }).safeParse(request.query);
      const roomWhere = apptRoomFilter(request.ctx.centerId, sq.success ? sq.data.centerId : undefined, sq.success ? sq.data.roomId : undefined);
      const centerFilter = roomWhere ? { appointment: { room: roomWhere } } : {};
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 86_400_000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [pending, expiringSoon, completedThisMonth, aptoThisMonth] = await Promise.all([
        prisma.revision.count({ where: { tenantId, outcome: "PENDING", ...centerFilter } }),
        prisma.revision.count({ where: { tenantId, outcome: "APTO", expiryDate: { not: null, lte: in30 }, ...centerFilter } }),
        prisma.revision.count({ where: { tenantId, outcome: { not: "PENDING" }, completedAt: { gte: monthStart }, ...centerFilter } }),
        prisma.revision.count({ where: { tenantId, outcome: "APTO", completedAt: { gte: monthStart }, ...centerFilter } }),
      ]);
      // Tasa de aptitud del mes = aptas / completadas (null si aún no hay completadas).
      const aptitudeRate = completedThisMonth > 0 ? Math.round((aptoThisMonth / completedThisMonth) * 100) : null;
      return reply.send({ data: { pending, expiringSoon, completedThisMonth, aptoThisMonth, aptitudeRate }, errors: null });
    });

  // POST /revisions/:id/renewal-link — magic link de auto-reserva + contexto para el
  // aviso manual: si el cliente ya tiene cita futura para ese producto y cuándo fue el
  // último aviso (para evitar reenvíos ciegos). El enlace (/booking/:token) es el mismo
  // que envía el recordatorio automático.
  server.post<{ Params: { id: string } }>("/revisions/:id/renewal-link", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request, reply: FastifyReply) => {
      const rev = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        select: { customerId: true, productId: true, tenantId: true },
      });
      if (!rev) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const token = signMagicLinkToken({ cid: rev.customerId, pid: rev.productId, tid: rev.tenantId, type: "magic_link" });

      const [futureAppt, lastAviso] = await Promise.all([
        prisma.appointment.findFirst({
          where: { customerId: rev.customerId, productId: rev.productId, tenantId: request.ctx.tenantId, scheduledAt: { gt: new Date() }, status: { in: ["CONFIRMED", "PENDING"] } },
          orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true },
        }),
        prisma.customerEvent.findFirst({
          where: { customerId: rev.customerId, tenantId: request.ctx.tenantId, type: "recordatorio_renovacion" },
          orderBy: { createdAt: "desc" }, select: { createdAt: true, channel: true },
        }),
      ]);

      // Página pública de auto-reserva: /booking/:token (consume la API /link/:token).
      return reply.send({
        data: {
          url: `${PUBLIC_URL}/booking/${token}`,
          futureAppointment: futureAppt ? { scheduledAt: futureAppt.scheduledAt } : null,
          lastAviso: lastAviso ? { at: lastAviso.createdAt, channel: lastAviso.channel } : null,
        },
        errors: null,
      });
    });

  // POST /revisions/:id/aviso — registra que recepción avisó al cliente por un canal.
  // Queda en el historial del cliente (tone "comm") y alimenta el "último aviso".
  const avisoBodySchema = z.object({ channel: z.enum(["WHATSAPP", "EMAIL", "LINK"]) });
  server.post<{ Params: { id: string } }>("/revisions/:id/aviso", { preHandler: [requireAnyRole(ROLES_STAFF)] },
    async (request, reply: FastifyReply) => {
      const body = avisoBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const rev = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        select: { customerId: true, appointment: { select: { product: { select: { name: true } } } } },
      });
      if (!rev) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      await prisma.customerEvent.create({
        data: { tenantId: request.ctx.tenantId, customerId: rev.customerId, type: "recordatorio_renovacion", channel: body.data.channel, actor: "recepcion", detail: rev.appointment.product.name },
      }).catch(() => {});
      return reply.send({ data: { ok: true }, errors: null });
    });

  // GET /revisions/:id
  server.get<{ Params: { id: string } }>("/revisions/:id", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
    async (request, reply: FastifyReply) => {
      const include = {
        formTemplate: true,
        attachments: true,
        appointment: { include: { customer: true, product: true } },
      } as const;

      const revision = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, ...(request.ctx.centerId ? { appointment: { room: { centerId: request.ctx.centerId } } } : {}) },
        include,
      });
      if (!revision) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      // Una revisión se enlaza al formulario activo del momento en que se creó. Si
      // aún está PENDIENTE y sin datos rellenos, la re-enlazamos al formulario
      // activo actual del producto: así, si el formulario se creó/cambió después
      // (p.ej. la revisión arrancó con un formulario vacío de relleno), el médico
      // ve la versión vigente. Al guardar datos queda fijada y ya no se re-enlaza.
      const formDataEmpty = !revision.formData || Object.keys(revision.formData as Record<string, unknown>).length === 0;
      if (revision.outcome === "PENDING" && formDataEmpty) {
        const active = await prisma.formTemplate.findFirst({ where: { productId: revision.productId, isActive: true } });
        if (active && active.id !== revision.formTemplateId) {
          const repointed = await prisma.revision.update({ where: { id: revision.id }, data: { formTemplateId: active.id }, include });
          return reply.send({ data: repointed, errors: null });
        }
      }
      return reply.send({ data: revision, errors: null });
    });

  // PATCH /revisions/:id — save partial form data
  server.patch<{ Params: { id: string } }>("/revisions/:id", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
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
  server.post<{ Params: { id: string } }>("/revisions/:id/complete", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
    async (request, reply: FastifyReply) => {
      const body = z.object({
        formData: z.record(z.unknown()),
        outcome: z.enum(["APTO", "NO_APTO"]),
        notes: z.string().optional(),
      }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const existing = await prisma.revision.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, outcome: "PENDING" },
        include: { formTemplate: true, attachments: true, appointment: { include: { product: true, customer: true } } },
      });
      if (!existing) return reply.status(404).send({ errors: [{ code: "NOT_FOUND_OR_COMPLETED" }] });

      // No se puede finalizar si faltan datos obligatorios: campos requeridos del
      // formulario, notas clínicas y firma del paciente (y debe existir formulario).
      const schemaFields = (((existing.formTemplate.schema as { fields?: RevFieldDef[] })?.fields) ?? []);
      const missing = missingForCompletion({
        fields: schemaFields,
        formData: body.data.formData as Record<string, unknown>,
        attachmentFieldIds: existing.attachments.map((a) => a.fieldId),
        notes: body.data.notes,
      });
      if (missing.length > 0) {
        return reply.status(400).send({ errors: [{ code: "INCOMPLETE_REVISION", message: "Faltan datos para finalizar la revisión", fields: missing }] });
      }

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
          // El médico de registro es quien finaliza/firma la revisión (su nombre,
          // colegiado y firma van en el certificado), no quien la abrió.
          doctorId: request.ctx.userId,
          completedAt,
          expiryDate,
        },
      });

      // La cita queda marcada como ATENDIDA al completar la revisión.
      await prisma.appointment.update({ where: { id: existing.appointmentId }, data: { status: "ATTENDED" } });

      // Cierra la visita (episodio físico) si estaba enlazada: sale del centro.
      if (existing.visitId) {
        await prisma.visit.update({ where: { id: existing.visitId }, data: { status: "COMPLETED", completedAt } });
      }

      // Generación de PDF best-effort: no bloquea la respuesta ni rompe el flujo
      // si Puppeteer/Chromium fallara (se puede regenerar al pedir el PDF).
      generatePdf(request.params.id).catch((err) => {
        request.log.error(err, "[pdf] background generation failed");
      });

      return reply.send({ data: updated, errors: null });
    });

  // GET /revisions/:id/pdf — genera (si falta) y sirve el certificado en PDF
  server.get<{ Params: { id: string } }>("/revisions/:id/pdf", { preHandler: [requireAnyRole(ROLES_STAFF)] },
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
    "/revisions/:id/attachments", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
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
    "/revisions/:id/attachments/:attId", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
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
    "/revisions/:id/attachments/:attId", { preHandler: [requireAnyRole(ROLES_CLINICAL)] },
    async (request, reply: FastifyReply) => {
      const attachment = await prisma.revisionAttachment.findFirst({
        where: { id: request.params.attId, revision: { id: request.params.id, tenantId: request.ctx.tenantId } },
      });
      if (!attachment) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      await prisma.revisionAttachment.delete({ where: { id: attachment.id } });
      return reply.status(204).send();
    });
}
