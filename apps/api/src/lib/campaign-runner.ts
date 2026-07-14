import { prisma } from "./prisma.js";
import { email, renderTemplate } from "./email.js";
import { buildCustomerWhere, type SegmentDefinition } from "./segments.js";
import type { MessageChannel } from "@prisma/client";

// Cliente resuelto para el envío (con consentimiento y datos para variables).
interface Recip {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  acceptsEmail: boolean;
  acceptsWhatsapp: boolean;
  acceptsSms: boolean;
  revisions: { expiryDate: Date | null; appointment: { product: { name: string } | null; room: { center: { name: string } | null } | null } | null }[];
}

// ¿Se puede contactar a este cliente por el canal? (consentimiento + medio).
function contactFor(channel: MessageChannel, c: Recip): { ok: boolean; to: string | null } {
  if (channel === "EMAIL") return { ok: c.acceptsEmail && !!c.email, to: c.email };
  if (channel === "WHATSAPP") return { ok: c.acceptsWhatsapp && !!c.phone, to: c.phone };
  return { ok: c.acceptsSms && !!c.phone, to: c.phone }; // SMS
}

// Variables de plantilla para un cliente. producto/caduca/centro se toman de la
// revisión APTA que antes caduca (útil en avisos de renovación; vacías si no hay).
function customerVars(c: Recip): Record<string, string> {
  const rev = c.revisions[0];
  return {
    nombre: c.firstName ?? "",
    apellido: c.lastName ?? "",
    producto: rev?.appointment?.product?.name ?? "",
    caduca: rev?.expiryDate ? new Date(rev.expiryDate).toLocaleDateString("es-ES") : "",
    centro: rev?.appointment?.room?.center?.name ?? "",
  };
}

// Entrega por el canal. El email se envía de verdad (Resend si hay credenciales,
// si no se registra). WhatsApp de texto libre requiere plantilla aprobada de Meta
// y SMS un proveedor; por ahora se registran (listo para enchufar el proveedor).
async function deliver(channel: MessageChannel, to: string, subject: string, body: string): Promise<void> {
  if (channel === "EMAIL") {
    await email.sendEmail({ to, subject, body });
    return;
  }
  console.log(`[campaign:${String(channel).toLowerCase()}] -> ${to} ${JSON.stringify(body.slice(0, 140))}`);
}

// Envía una campaña de forma idempotente: resuelve el segmento, renderiza y envía
// por el canal respetando consentimiento, y materializa los contadores + la traza
// por destinatario. Recibe tenantId explícito para poder ejecutarse desde el cron
// (sin contexto de tenant en AsyncLocalStorage).
export async function sendCampaign(campaignId: string, tenantId: string): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    include: { template: true, segment: true },
  });
  if (!campaign) return;
  if (campaign.status === "SENDING" || campaign.status === "SENT") return; // ya en curso/enviada

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });

  try {
    const def = campaign.segment.definition as SegmentDefinition;
    const where = buildCustomerWhere(def);
    const customers = (await prisma.customer.findMany({
      where: { ...where, tenantId },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        acceptsEmail: true, acceptsWhatsapp: true, acceptsSms: true,
        revisions: {
          where: { outcome: "APTO", expiryDate: { not: null } },
          orderBy: { expiryDate: "asc" },
          take: 1,
          select: {
            expiryDate: true,
            appointment: { select: { product: { select: { name: true } }, room: { select: { center: { select: { name: true } } } } } },
          },
        },
      },
    })) as Recip[];

    let sent = 0, failed = 0, skipped = 0;
    for (const c of customers) {
      const { ok, to } = contactFor(campaign.channel, c);
      if (!ok || !to) {
        skipped++;
        await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, customerId: c.id, status: "SKIPPED", error: "Sin consentimiento o sin medio de contacto" } });
        continue;
      }
      const vars = customerVars(c);
      const subject = renderTemplate(campaign.template.subject ?? "", vars);
      const body = renderTemplate(campaign.template.body, vars);
      try {
        await deliver(campaign.channel, to, subject, body);
        sent++;
        await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, customerId: c.id, status: "SENT", sentAt: new Date() } });
      } catch (err) {
        failed++;
        await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, customerId: c.id, status: "FAILED", error: (err as Error).message.slice(0, 300) } });
      }
    }

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENT", sentAt: new Date(), totalCount: customers.length, sentCount: sent, failedCount: failed, skippedCount: skipped },
    });
  } catch (err) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
    console.error(`[campaign] Error enviando ${campaign.id}:`, err);
  }
}

// Barrido de campañas programadas cuyo momento ya llegó (llamado desde el cron).
// Cross-tenant: recorre todas las pendientes y las envía con su propio tenantId.
export async function runDueCampaigns(): Promise<void> {
  const now = new Date();
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { not: null, lte: now } },
    select: { id: true, tenantId: true },
  });
  for (const c of due) {
    try { await sendCampaign(c.id, c.tenantId); }
    catch (err) { console.error(`[campaign-cron] Error en ${c.id}:`, err); }
  }
}
