import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import { stripUndefined } from "../lib/utils.js";
import { encryptDni, decryptDni } from "../lib/crypto.js";
import { validateSpanishDni, hashDni } from "../lib/dni.js";
import { storage } from "../lib/storage.js";
import { appointmentEvents, mapCustomerEvents, type TimelineEvent } from "../lib/appointment-timeline.js";
import { signConfirmationToken } from "../lib/jwt.js";

const PUBLIC_URL = process.env["PUBLIC_URL"] ?? "http://localhost:3000";

const customerSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  dni: z.string().min(7).max(15),  // cleartext input, we store hash + encrypted
  birthDate: z.string().datetime().optional(),
  nationality: z.string().optional(),
  municipality: z.string().optional(),
  province: z.string().optional(),
  notes: z.string().optional(),
  gdprInformedAt: z.string().datetime().optional(),
  gdprConsentAt: z.string().datetime().optional(),
  gdprConsentIp: z.string().optional(),
});

// Los consentimientos de comunicación se guardan por el endpoint dedicado
// PUT /customers/:id/consent, que exige firma + al menos un canal.
const consentSchema = z.object({
  acceptsEmail: z.boolean(),
  acceptsSms: z.boolean(),
  acceptsWhatsapp: z.boolean(),
});

const CONSENT_SIGNATURE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const listQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});


export async function customerRoutes(server: FastifyInstance) {
  server.get("/customers", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;

      const where: Record<string, unknown> = { tenantId: request.ctx.tenantId, deletedAt: null };
      if (query.q) {
        where["OR"] = [
          { firstName: { contains: query.q, mode: "insensitive" } },
          { lastName: { contains: query.q, mode: "insensitive" } },
          { email: { contains: query.q, mode: "insensitive" } },
          { phone: { contains: query.q } },
        ];
      }

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({ where, skip, take: query.limit, orderBy: { lastName: "asc" } }),
        prisma.customer.count({ where }),
      ]);

      return reply.send({
        data: customers,
        meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
        errors: null,
      });
    });

  // GET /customers/stats — KPIs globales de la cartera (todo el tenant, no la página).
  server.get("/customers/stats", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const base = { tenantId: request.ctx.tenantId, deletedAt: null };
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [total, new30d, withEmail, withPhone] = await Promise.all([
        prisma.customer.count({ where: base }),
        prisma.customer.count({ where: { ...base, createdAt: { gte: since } } }),
        prisma.customer.count({ where: { ...base, AND: [{ email: { not: null } }, { email: { not: "" } }] } }),
        prisma.customer.count({ where: { ...base, AND: [{ phone: { not: null } }, { phone: { not: "" } }] } }),
      ]);
      return reply.send({ data: { total, new30d, withEmail, withPhone }, errors: null });
    });

  server.post("/customers", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = customerSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const dniHash = hashDni(body.data.dni);
      if (!validateSpanishDni(body.data.dni)) {
        return reply.status(400).send({ errors: [{ code: "INVALID_DNI", message: "DNI/NIE con letra de control incorrecta" }] });
      }

      const existing = await prisma.customer.findFirst({ where: { tenantId: request.ctx.tenantId, dniHash } });
      if (existing) return reply.status(409).send({ errors: [{ code: "DNI_TAKEN", message: "DNI ya registrado" }] });

      const { dni, birthDate, gdprConsentAt, gdprInformedAt, ...rest } = body.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customer = await prisma.customer.create({
        data: {
          tenantId: request.ctx.tenantId,
          ...stripUndefined(rest),
          dniHash,
          dniEncrypted: encryptDni(dni),
          birthDate: birthDate ? new Date(birthDate) : null,
          gdprInformedAt: gdprInformedAt ? new Date(gdprInformedAt) : null,
          gdprConsentAt: gdprConsentAt ? new Date(gdprConsentAt) : null,
        } as any,
      });
      return reply.status(201).send({ data: customer, errors: null });
    });

  server.get<{ Params: { id: string } }>("/customers/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        include: {
          appointments: {
            include: { product: true, room: { include: { center: true } } },
            orderBy: { scheduledAt: "desc" },
            take: 10,
          },
        },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      // DNI descifrado para el personal (el campo en BD está cifrado en reposo).
      let dni: string | null = null;
      if (customer.dniEncrypted) { try { dni = decryptDni(customer.dniEncrypted); } catch { dni = null; } }
      return reply.send({ data: { ...customer, dni }, errors: null });
    });

  // GET /customers/:id/export — RGPD: exporta TODOS los datos del cliente (derecho de acceso/portabilidad).
  server.get<{ Params: { id: string } }>("/customers/:id/export", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        include: {
          appointments: { include: { product: { select: { name: true } }, room: { select: { name: true, center: { select: { name: true } } } } }, orderBy: { scheduledAt: "desc" } },
          revisions: { include: { appointment: { select: { product: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } },
        },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const events = await prisma.customerEvent.findMany({ where: { customerId: customer.id, tenantId: request.ctx.tenantId }, orderBy: { createdAt: "desc" } });
      let dni: string | null = null;
      if (customer.dniEncrypted) { try { dni = decryptDni(customer.dniEncrypted); } catch { dni = null; } }
      const { dniEncrypted: _e, dniHash: _h, appointments, revisions, ...personal } = customer;

      return reply.send({
        data: {
          exportadoEl: new Date().toISOString(),
          cliente: { ...personal, dni },
          citas: appointments.map((a) => ({ fecha: a.scheduledAt, estado: a.status, producto: a.product?.name ?? null, sala: a.room?.name ?? null, centro: a.room?.center?.name ?? null })),
          revisiones: revisions.map((r) => ({ resultado: r.outcome, inicio: r.startedAt, fin: r.completedAt, caducidad: r.expiryDate, producto: r.appointment?.product?.name ?? null })),
          eventos: events.map((e) => ({ tipo: e.type, actor: e.actor, fecha: e.createdAt })),
        },
        errors: null,
      });
    });

  server.patch<{ Params: { id: string } }>("/customers/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const body = customerSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const { dni, ...rest } = body.data;
      const updateData: Record<string, unknown> = stripUndefined({ ...rest });
      if (rest.birthDate) updateData["birthDate"] = new Date(rest.birthDate);
      if (rest.gdprConsentAt) updateData["gdprConsentAt"] = new Date(rest.gdprConsentAt);

      // El DNI solo lo puede modificar un administrador; se re-cifra y re-hashea,
      // validando letra de control y unicidad dentro del tenant.
      if (dni !== undefined) {
        if (request.ctx.role !== "ADMIN" && request.ctx.role !== "SUPERADMIN") {
          return reply.status(403).send({ errors: [{ code: "FORBIDDEN", message: "Solo un administrador puede modificar el DNI" }] });
        }
        if (!validateSpanishDni(dni)) {
          return reply.status(400).send({ errors: [{ code: "INVALID_DNI", message: "DNI/NIE con letra de control incorrecta" }] });
        }
        const dniHash = hashDni(dni);
        const dup = await prisma.customer.findFirst({
          where: { tenantId: request.ctx.tenantId, dniHash, deletedAt: null, id: { not: request.params.id } },
          select: { id: true },
        });
        if (dup) return reply.status(409).send({ errors: [{ code: "DNI_TAKEN", message: "DNI ya registrado en otro cliente" }] });
        updateData["dniEncrypted"] = encryptDni(dni);
        updateData["dniHash"] = dniHash;
      }

      const result = await prisma.customer.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        data: updateData,
      });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  // Revision history
  server.get<{ Params: { id: string } }>("/customers/:id/revisions", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const revisions = await prisma.revision.findMany({
        where: { appointment: { customerId: request.params.id, tenantId: request.ctx.tenantId } },
        include: {
          appointment: { include: { product: true } },
          doctor: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ data: revisions, errors: null });
    });

  // GET /customers/:id/timeline — historial cronológico agregado (reservas, visitas,
  // revisiones y comunicaciones): el "log de qué ha pasado" con este cliente.
  server.get<{ Params: { id: string } }>("/customers/:id/timeline", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null }, select: { id: true },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const cid = customer.id;

      const [appts, workflow, campaigns, custEvents] = await Promise.all([
        prisma.appointment.findMany({
          where: { customerId: cid, tenantId: request.ctx.tenantId },
          select: {
            id: true, scheduledAt: true, status: true, source: true, cancelReason: true, createdAt: true, updatedAt: true,
            product: { select: { name: true } },
            room: { select: { name: true } },
            visit: { select: { arrivedAt: true, calledAt: true, startedAt: true, status: true, updatedAt: true, currentRoom: { select: { name: true } } } },
            revision: { select: { outcome: true, completedAt: true, expiryDate: true, startedAt: true } },
          },
        }),
        prisma.workflowExecution.findMany({ where: { customerId: cid, status: "SENT", lastAttemptAt: { not: null } }, select: { lastAttemptAt: true } }),
        prisma.campaignRecipient.findMany({ where: { customerId: cid, status: "SENT", sentAt: { not: null } }, select: { sentAt: true, campaign: { select: { name: true, channel: true } } } }),
        prisma.customerEvent.findMany({ where: { customerId: cid, tenantId: request.ctx.tenantId }, select: { type: true, channel: true, detail: true, createdAt: true, appointmentId: true } }),
      ]);

      const iso = (d: Date) => d.toISOString();
      // Agrupa los eventos registrados por su cita, para armar la trazabilidad de cada una.
      const byAppt: Record<string, typeof custEvents> = {};
      for (const e of custEvents) { const k = e.appointmentId ?? "_"; (byAppt[k] ??= []).push(e); }

      const events: TimelineEvent[] = [];
      for (const a of appts) events.push(...appointmentEvents(a, byAppt[a.id] ?? []));
      // Eventos de nivel cliente (sin cita concreta, p. ej. recordatorio de renovación).
      events.push(...mapCustomerEvents(byAppt["_"] ?? []));
      // Comunicaciones a nivel de cliente (no atadas a una cita concreta).
      for (const w of workflow) if (w.lastAttemptAt) events.push({ at: iso(w.lastAttemptAt), kind: "recordatorio", title: "Recordatorio de renovación", detail: "WhatsApp", tone: "comm" });
      for (const c of campaigns) if (c.sentAt) events.push({ at: iso(c.sentAt), kind: "campana", title: `Campaña «${c.campaign?.name ?? ""}»`, detail: c.campaign?.channel ?? "", tone: "comm" });

      events.sort((x, y) => y.at.localeCompare(x.at));
      return reply.send({ data: events, errors: null });
    });

  // POST /customers/:id/renewal-link?productId= — enlace de reserva de renovación
  // para enviar por WhatsApp/email. Devuelve URL + contacto/consentimiento; registra evento.
  server.post<{ Params: { id: string }; Querystring: { productId?: string } }>("/customers/:id/renewal-link", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const productId = request.query.productId;
      if (!productId) return reply.status(400).send({ errors: [{ code: "PRODUCT_REQUIRED", message: "Falta el producto" }] });
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, phone: true, email: true, acceptsWhatsapp: true, acceptsEmail: true },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const product = await prisma.product.findFirst({ where: { id: productId, tenantId: request.ctx.tenantId, active: true }, select: { id: true, name: true } });
      if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });
      const token = signConfirmationToken({ cid: customer.id, pid: product.id, tid: request.ctx.tenantId, type: "magic_link" });
      await prisma.customerEvent.create({ data: { tenantId: request.ctx.tenantId, customerId: customer.id, type: "recordatorio_renovacion", actor: "recepcion", detail: product.name } }).catch(() => {});
      return reply.send({ data: { url: `${PUBLIC_URL}/booking/${token}`, customer, product }, errors: null });
    });

  // GET /customers/:id/commercial-summary — renovaciones (caducidades por producto) +
  // métricas + contactos, para la pestaña de acciones comerciales.
  server.get<{ Params: { id: string } }>("/customers/:id/commercial-summary", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null }, select: { id: true } });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const cid = customer.id;

      const [revs, noShows, workflow, campaigns, custEvents] = await Promise.all([
        prisma.revision.findMany({ where: { appointment: { customerId: cid, tenantId: request.ctx.tenantId } }, select: { outcome: true, expiryDate: true, completedAt: true, appointment: { select: { product: { select: { id: true, name: true } } } } } }),
        prisma.appointment.count({ where: { customerId: cid, tenantId: request.ctx.tenantId, status: "NO_SHOW" } }),
        prisma.workflowExecution.findMany({ where: { customerId: cid, status: "SENT" }, select: { lastAttemptAt: true } }),
        prisma.campaignRecipient.findMany({ where: { customerId: cid, status: "SENT" }, select: { sentAt: true } }),
        prisma.customerEvent.findMany({ where: { customerId: cid, tenantId: request.ctx.tenantId }, select: { type: true, createdAt: true } }),
      ]);

      // Renovaciones: la última revisión APTA por producto (su certificado vigente = oportunidad).
      const byProduct: Record<string, { productId: string; productName: string; expiryDate: string }> = {};
      for (const r of revs) {
        if (r.outcome !== "APTO" || !r.expiryDate || !r.appointment.product) continue;
        const p = r.appointment.product;
        const t = r.expiryDate.toISOString();
        const cur = byProduct[p.id];
        if (!cur || t > cur.expiryDate) byProduct[p.id] = { productId: p.id, productName: p.name, expiryDate: t };
      }
      const renewals = Object.values(byProduct).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

      const completedRevs = revs.filter((r) => r.completedAt);
      const lastVisitAt = completedRevs.reduce<string | null>((max, r) => { const t = r.completedAt!.toISOString(); return !max || t > max ? t : max; }, null);

      const commTypes = new Set(["recordatorio_renovacion", "confirmacion_solicitada"]);
      const contactTimes = [
        ...workflow.map((w) => w.lastAttemptAt?.toISOString()),
        ...campaigns.map((c) => c.sentAt?.toISOString()),
        ...custEvents.filter((e) => commTypes.has(e.type)).map((e) => e.createdAt.toISOString()),
      ].filter((t): t is string => !!t);
      const lastContactAt = contactTimes.length ? contactTimes.sort().slice(-1)[0]! : null;

      return reply.send({
        data: { renewals, metrics: { revisions: completedRevs.length, noShows, lastVisitAt, contacts: contactTimes.length, lastContactAt } },
        errors: null,
      });
    });

  // RGPD: firma de consentimiento del paciente (sube/reemplaza). Imagen PNG/JPG/WEBP.
  server.post<{ Params: { id: string } }>("/customers/:id/consent-signature", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const file = await request.file();
      if (!file) return reply.status(400).send({ errors: [{ code: "NO_FILE" }] });
      if (!CONSENT_SIGNATURE_MIME.has(file.mimetype)) {
        return reply.status(400).send({ errors: [{ code: "INVALID_FILE_TYPE", message: "Solo JPG, PNG o WEBP" }] });
      }
      const buffer = await file.toBuffer();
      if (file.file.truncated) return reply.status(413).send({ errors: [{ code: "FILE_TOO_LARGE", message: "Máximo 10 MB" }] });

      const key = `tenants/${request.ctx.tenantId}/customers/${request.params.id}/consent-signature.png`;
      await storage.put(key, buffer, file.mimetype);
      await prisma.customer.update({ where: { id: request.params.id }, data: { consentSignatureKey: key } });
      return reply.status(201).send({ data: { saved: true }, errors: null });
    });

  // RGPD: sirve la firma de consentimiento del paciente.
  server.get<{ Params: { id: string } }>("/customers/:id/consent-signature", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        select: { consentSignatureKey: true },
      });
      if (!customer?.consentSignatureKey) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      try {
        const bytes = await storage.get(customer.consentSignatureKey);
        return reply.header("Content-Type", "image/png").header("Content-Disposition", 'inline; filename="firma-consentimiento.png"').send(bytes);
      } catch (err) {
        request.log.error(err, "[consent-signature] error serving file");
        return reply.status(404).send({ errors: [{ code: "FILE_NOT_FOUND" }] });
      }
    });

  // RGPD: guardar el consentimiento. Requiere firma del paciente y al menos un
  // medio de comunicación aceptado; registra la fecha/IP del consentimiento.
  server.put<{ Params: { id: string } }>("/customers/:id/consent", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const body = consentSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const customer = await prisma.customer.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId, deletedAt: null },
        select: { consentSignatureKey: true },
      });
      if (!customer) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });

      const missing: string[] = [];
      if (!customer.consentSignatureKey) missing.push("Firma del paciente");
      if (!body.data.acceptsEmail && !body.data.acceptsSms && !body.data.acceptsWhatsapp) missing.push("Al menos un medio de comunicación");
      if (missing.length > 0) {
        return reply.status(400).send({ errors: [{ code: "CONSENT_INCOMPLETE", message: "No se puede guardar el consentimiento", fields: missing }] });
      }

      await prisma.customer.update({
        where: { id: request.params.id },
        data: {
          acceptsEmail: body.data.acceptsEmail,
          acceptsSms: body.data.acceptsSms,
          acceptsWhatsapp: body.data.acceptsWhatsapp,
          gdprConsentAt: new Date(),
          gdprConsentIp: request.ip,
        },
      });
      return reply.send({ data: { saved: true }, errors: null });
    });

  // Soft delete
  server.delete<{ Params: { id: string } }>("/customers/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.customer.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: { deletedAt: new Date() },
      });
      return reply.status(204).send();
    });
}
