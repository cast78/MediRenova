// Portal del paciente ("Mi área"): rutas públicas por token de portal. El propio
// cliente accede sin login de staff (ver crm-portal-paciente). REGLA DE ORO: cada
// consulta filtra explícitamente por `customerId` (la extensión Prisma solo aísla
// por tenant, no por cliente; la RLS está definida pero inerte en runtime).
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { setTenantContext } from "../lib/tenant-context.js";
import { signPortalToken, verifyPortalToken } from "../lib/jwt.js";
import { hashDni } from "../lib/dni.js";
import { email, emailConfigured } from "../lib/email.js";
import { ensureRevisionPdf } from "../lib/pdf.js";

const PUBLIC_URL = process.env["PUBLIC_URL"] ?? "http://localhost:3000";

declare module "fastify" {
  interface FastifyRequest {
    portal?: { cid: string; tid: string };
  }
}

// Auditoría de portal: el actor es el cliente (no un User), así que userId va NULL
// y el cliente queda en resourceId/meta. Nunca lanza.
function portalAudit(tenantId: string, resourceType: string, resourceId: string, meta: object, ip?: string) {
  return prisma.auditLog.create({
    data: { tenantId, userId: null, action: "UPDATE", resourceType, resourceId, meta, ipAddress: ip ?? null },
  }).catch(() => {});
}

export async function portalRoutes(server: FastifyInstance) {
  // preHandler: valida el token de portal (Authorization: Bearer) y fija el contexto
  // de tenant (capa Prisma). El filtro por customerId lo pone cada handler.
  const requirePortal = async (request: FastifyRequest, reply: FastifyReply) => {
    const h = request.headers.authorization;
    if (!h?.startsWith("Bearer ")) return reply.status(401).send({ errors: [{ code: "PORTAL_UNAUTHENTICATED", message: "Inicia sesión en tu área" }] });
    try {
      const p = verifyPortalToken(h.slice(7));
      request.portal = { cid: p.cid, tid: p.tid };
      setTenantContext({ tenantId: p.tid, role: "CUSTOMER" });
    } catch {
      return reply.status(401).send({ errors: [{ code: "PORTAL_SESSION_INVALID", message: "Tu sesión ha caducado. Vuelve a solicitar acceso." }] });
    }
  };

  // POST /portal/request-access — el paciente pide acceso con DNI + fecha de
  // nacimiento; si coincide con su ficha, se le envía un enlace al email almacenado.
  // Respuesta SIEMPRE genérica (anti-enumeración) + rate-limit estricto.
  server.post("/portal/request-access", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const generic = { data: { ok: true }, errors: null };
      const body = z.object({ tenantSlug: z.string().min(1), dni: z.string().min(1), birthDate: z.string().min(8) }).safeParse(request.body);
      if (!body.success) return reply.send(generic);

      const tenant = await prisma.tenant.findFirst({ where: { slug: body.data.tenantSlug, active: true }, select: { id: true, name: true } });
      if (!tenant) return reply.send(generic);

      const customer = await prisma.customer.findFirst({
        where: { tenantId: tenant.id, dniHash: hashDni(body.data.dni), deletedAt: null },
        select: { id: true, birthDate: true, email: true },
      });
      // Debe coincidir la fecha de nacimiento (día).
      if (!customer?.birthDate || customer.birthDate.toISOString().slice(0, 10) !== body.data.birthDate.slice(0, 10)) return reply.send(generic);

      const token = signPortalToken({ cid: customer.id, tid: tenant.id });
      const url = `${PUBLIC_URL}/mi-area/entrar?token=${token}`;

      // Modo transitorio "revelar enlace": mientras el email NO esté configurado
      // (sin RESEND_API_KEY/EMAIL_FROM) no hay forma de hacer llegar el enlace, así
      // que se devuelve para copiarlo y enviarlo a mano (WhatsApp/email). Se desactiva
      // solo en cuanto el email quede configurado, y entonces vuelve al envío normal.
      // AVISO: en este modo se salta la anti-enumeración (revela si el DNI+fecha existe).
      if (!emailConfigured) {
        await portalAudit(tenant.id, "customer", customer.id, { kind: "portal_access_link_revealed" }, request.ip);
        return reply.send({ data: { ok: true, link: url }, errors: null });
      }

      // Modo normal: enviar el enlace al email de la ficha (requiere email válido).
      if (!customer.email?.includes("@")) return reply.send(generic);
      try {
        await email.sendEmail({
          to: customer.email,
          subject: `Acceso a tu área de paciente · ${tenant.name}`,
          body: `Has solicitado acceso a tu área de paciente.\nEntra desde este enlace (válido 60 minutos):\n${url}\n\nSi no lo has solicitado, ignora este mensaje.`,
        });
      } catch (e) { request.log.error(e, "[portal] email de acceso falló"); }
      await portalAudit(tenant.id, "customer", customer.id, { kind: "portal_access_requested" }, request.ip);
      return reply.send(generic);
    });

  // GET /portal/me — datos mínimos para la cabecera del portal.
  server.get("/portal/me", { preHandler: [requirePortal] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const c = await prisma.customer.findFirst({ where: { id: request.portal!.cid, tenantId: request.portal!.tid }, select: { firstName: true, lastName: true } });
    const tenant = await prisma.tenant.findUnique({ where: { id: request.portal!.tid }, select: { name: true } });
    return reply.send({ data: { name: `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim() || "Paciente", center: tenant?.name ?? null }, errors: null });
  });

  // GET /portal/revisions — mis reconocimientos completados.
  server.get("/portal/revisions", { preHandler: [requirePortal] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const revs = await prisma.revision.findMany({
      where: { tenantId: request.portal!.tid, customerId: request.portal!.cid, completedAt: { not: null }, outcome: { in: ["APTO", "NO_APTO"] } },
      select: { id: true, outcome: true, completedAt: true, expiryDate: true, appointment: { select: { product: { select: { name: true } } } } },
      orderBy: { completedAt: "desc" },
    });
    return reply.send({ data: revs.map((r) => ({ id: r.id, outcome: r.outcome, completedAt: r.completedAt, expiryDate: r.expiryDate, product: r.appointment?.product?.name ?? null })), errors: null });
  });

  // GET /portal/revisions/:id/pdf — descarga; verifica que la revisión es del cliente.
  server.get<{ Params: { id: string } }>("/portal/revisions/:id/pdf", { preHandler: [requirePortal] },
    async (request, reply: FastifyReply) => {
      const rev = await prisma.revision.findFirst({ where: { id: request.params.id, tenantId: request.portal!.tid, customerId: request.portal!.cid }, select: { id: true } });
      if (!rev) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      try {
        const pdf = await ensureRevisionPdf(request.params.id, request.portal!.tid);
        await portalAudit(request.portal!.tid, "revision", request.params.id, { kind: "portal_pdf_downloaded", customerId: request.portal!.cid }, request.ip);
        return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="certificado-${request.params.id}.pdf"`).send(pdf);
      } catch (err) {
        request.log.error(err, "[portal] error sirviendo pdf");
        return reply.status(500).send({ errors: [{ code: "PDF_GENERATION_FAILED" }] });
      }
    });

  // GET /portal/appointments — mis citas (próximas + historial).
  server.get("/portal/appointments", { preHandler: [requirePortal] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const appts = await prisma.appointment.findMany({
      where: { tenantId: request.portal!.tid, customerId: request.portal!.cid },
      select: { id: true, scheduledAt: true, status: true, product: { select: { name: true } }, room: { select: { center: { select: { name: true } } } } },
      orderBy: { scheduledAt: "desc" }, take: 100,
    });
    return reply.send({ data: appts.map((a) => ({ id: a.id, scheduledAt: a.scheduledAt, status: a.status, product: a.product?.name ?? null, center: a.room?.center?.name ?? null })), errors: null });
  });
}
