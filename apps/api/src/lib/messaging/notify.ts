// Punto único de entrada para avisar al paciente (crm-mensajeria). Elige el canal
// (consentimiento × medio × preferencia del evento), renderiza la plantilla y deja
// SIEMPRE una fila en MessageDelivery:
//  - canal con proveedor real configurado → se envía y se guarda el resultado
//  - sin proveedor (modo demo) → solo se guarda (`provider: "demo"`, "Simulado")
//  - sin canal posible → `SKIPPED` con el motivo, para que recepción actúe a mano
// Nunca lanza: un fallo al avisar no debe romper la acción que lo disparó.
import type { MessageDelivery } from "@prisma/client";
import { prisma } from "../prisma.js";
import { email, emailConfigured } from "../email.js";
import { whatsapp, whatsappConfigured } from "../whatsapp.js";
import { tenantPlan } from "../authorization.js";
import { hasFeature } from "../plan.js";
import { selectChannel, type Channel } from "./select-channel.js";
import { renderMessage, EVENT_PREFER, EVENT_SERVICE, EVENT_LABELS, type MessagingEvent } from "./templates.js";

export interface NotifyOptions {
  tenantId: string;
  customerId: string;
  event: MessagingEvent;
  vars?: Record<string, string>;
  link?: string | null;
  appointmentId?: string | null;
  byUserId?: string | null; // null/undefined = sistema
  prefer?: Channel[] | undefined;
}

// Canales con proveedor real. SMS no tiene proveedor todavía (Fase C). En la
// Fase B el WhatsApp pasará a resolverse por clínica (TenantConfig) y no por env.
export function liveChannels(): Record<Channel, boolean> {
  return { EMAIL: emailConfigured, WHATSAPP: whatsappConfigured, SMS: false };
}

export async function notify(o: NotifyOptions): Promise<MessageDelivery | null> {
  try {
    // Plan (crm-planes): los avisos automáticos son Pro. Sin "messaging" no se
    // registra nada; los botones manuales siguen generando sus enlaces aparte.
    const plan = await tenantPlan(o.tenantId);
    if (!plan || !hasFeature(plan, "messaging")) return null;

    const customer = await prisma.customer.findFirst({
      where: { id: o.customerId, tenantId: o.tenantId },
      select: { firstName: true, phone: true, email: true, acceptsWhatsapp: true, acceptsSms: true, acceptsEmail: true },
    });
    if (!customer) return null;
    const tenant = await prisma.tenant.findUnique({ where: { id: o.tenantId }, select: { name: true } });

    const vars: Record<string, string> = {
      nombre: customer.firstName ?? "",
      clinica: tenant?.name ?? "MediRenova",
      enlace: o.link ?? "",
      ...(o.vars ?? {}),
    };
    const prefer = o.prefer ?? EVENT_PREFER[o.event];
    // Fase 0: todos los canales cuentan como "disponibles" para que la elección
    // sea la real; si el elegido no tiene proveedor, el aviso queda simulado.
    const sel = selectChannel({
      prefer,
      consent: { whatsapp: customer.acceptsWhatsapp, sms: customer.acceptsSms, email: customer.acceptsEmail },
      contact: { phone: customer.phone, email: customer.email },
      available: { WHATSAPP: true, SMS: true, EMAIL: true },
      service: EVENT_SERVICE.has(o.event),
    });

    const base = {
      tenantId: o.tenantId,
      customerId: o.customerId,
      appointmentId: o.appointmentId ?? null,
      event: o.event,
      byUserId: o.byUserId ?? null,
      vars,
      link: o.link ?? null,
    };

    if (!sel.channel) {
      const t = renderMessage(o.event, prefer[0] ?? "WHATSAPP", vars);
      return await prisma.messageDelivery.create({
        data: { ...base, channel: null, provider: "demo", status: "SKIPPED", subject: t.subject ?? null, body: t.body, cta: t.cta ?? null, reason: sel.reason },
      });
    }

    const t = renderMessage(o.event, sel.channel, vars);
    const common = { ...base, channel: sel.channel, to: sel.to, subject: t.subject ?? null, body: t.body, cta: t.cta ?? null, templateName: t.templateName ?? null };

    if (!liveChannels()[sel.channel]) {
      return await prisma.messageDelivery.create({ data: { ...common, provider: "demo", status: "SENT", sentAt: new Date() } });
    }

    // Envío real con el cliente del canal.
    const provider = sel.channel === "EMAIL" ? "resend" : sel.channel === "WHATSAPP" ? "meta" : "sms";
    try {
      if (sel.channel === "EMAIL") {
        const body = o.link ? `${t.body}\n\n${t.cta ?? "Abrir"}: ${o.link}` : t.body;
        await email.sendEmail({ to: sel.to, subject: t.subject ?? EVENT_LABELS[o.event], body });
      } else if (sel.channel === "WHATSAPP") {
        await whatsapp.sendTemplate({ to: sel.to, templateName: t.templateName ?? "medirenova_aviso", bodyParams: [o.link ?? ""] });
      }
      return await prisma.messageDelivery.create({ data: { ...common, provider, status: "SENT", sentAt: new Date() } });
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 300) : "Error de envío";
      return await prisma.messageDelivery.create({ data: { ...common, provider, status: "FAILED", reason } });
    }
  } catch (err) {
    console.error(`[messaging] notify(${o.event}) falló:`, err);
    return null;
  }
}
