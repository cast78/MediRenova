// Plantillas por defecto del sistema para los avisos transaccionales, por evento
// y canal (crm-mensajeria, Fase 0). Variables {{clave}} con el mismo motor que
// las campañas (`renderTemplate`). En Fase D pasan a ser editables por clínica
// (MessageTemplate.kind = TRANSACTIONAL) con estas como valor por defecto.
import { renderTemplate } from "../email.js";
import type { Channel } from "./select-channel.js";

export type MessagingEvent =
  | "appointment_created"
  | "appointment_rescheduled"
  | "confirmation_requested"
  | "noshow_invite"
  | "renewal_reminder"
  | "portal_access";

export const EVENT_LABELS: Record<MessagingEvent, string> = {
  appointment_created: "Cita creada",
  appointment_rescheduled: "Cita reprogramada",
  confirmation_requested: "Pedir confirmación",
  noshow_invite: "No-show · invitación",
  renewal_reminder: "Renovación",
  portal_access: "Acceso al portal",
};

// Orden de canales por evento (decisión D6): WhatsApp → SMS → Email, salvo el
// portal, donde el email es el canal natural del enlace de acceso.
export const EVENT_PREFER: Record<MessagingEvent, Channel[]> = {
  appointment_created: ["WHATSAPP", "SMS", "EMAIL"],
  appointment_rescheduled: ["WHATSAPP", "SMS", "EMAIL"],
  confirmation_requested: ["WHATSAPP", "EMAIL", "SMS"],
  noshow_invite: ["WHATSAPP", "EMAIL", "SMS"],
  renewal_reminder: ["WHATSAPP", "SMS", "EMAIL"],
  portal_access: ["EMAIL", "SMS", "WHATSAPP"],
};

// Mensajes de servicio solicitados por el propio paciente: no requieren
// consentimiento de marketing (sí medio de contacto).
export const EVENT_SERVICE: ReadonlySet<MessagingEvent> = new Set<MessagingEvent>(["portal_access"]);

export interface ChannelText {
  subject?: string;
  body: string;
  cta?: string;
  // Nombre de la plantilla aprobada en Meta (WhatsApp); informativo en modo demo.
  templateName?: string;
}

// Variables disponibles: nombre · clinica · producto · fecha · hora · centro ·
// sala (" (Sala 1)" o vacío) · caduca · enlace. En WhatsApp y email el enlace va
// en el botón (cta); en SMS va dentro del texto.
const T: Record<MessagingEvent, Record<Channel, ChannelText>> = {
  appointment_created: {
    WHATSAPP: { body: "Hola {{nombre}}, tu cita de {{producto}} es el {{fecha}} a las {{hora}} en {{centro}}{{sala}}.\n\nConfirma tu asistencia o avísanos si no podrás ir:", cta: "Confirmar cita", templateName: "medirenova_confirmacion_cita" },
    SMS: { body: "{{clinica}}: tu cita de {{producto}} es el {{fecha}} a las {{hora}} en {{centro}}. Confirma o avísanos: {{enlace}}" },
    EMAIL: { subject: "Tu cita del {{fecha}} a las {{hora}} · confirma tu asistencia", body: "Hola {{nombre}},\nTu cita de {{producto}} es el {{fecha}} a las {{hora}} en {{centro}}{{sala}}.\n\nConfirma tu asistencia o avísanos si no podrás ir con el botón:", cta: "Confirmar cita" },
  },
  appointment_rescheduled: {
    WHATSAPP: { body: "Hola {{nombre}}, hemos movido tu cita de {{producto}}: ahora es el {{fecha}} a las {{hora}} en {{centro}}{{sala}}.\n\nConfirma que te viene bien:", cta: "Confirmar nueva fecha", templateName: "medirenova_confirmacion_cita" },
    SMS: { body: "{{clinica}}: tu cita de {{producto}} se ha movido al {{fecha}} a las {{hora}} en {{centro}}. Confirma: {{enlace}}" },
    EMAIL: { subject: "Tu cita se ha movido al {{fecha}} a las {{hora}}", body: "Hola {{nombre}},\nHemos movido tu cita de {{producto}}: ahora es el {{fecha}} a las {{hora}} en {{centro}}{{sala}}.\n\nConfirma que te viene bien con el botón:", cta: "Confirmar nueva fecha" },
  },
  confirmation_requested: {
    WHATSAPP: { body: "Hola {{nombre}}, ¿podrás venir a tu cita de {{producto}} del {{fecha}} a las {{hora}}? Confírmanos con un toque:", cta: "Confirmar / No podré ir", templateName: "medirenova_confirmacion_cita" },
    SMS: { body: "{{clinica}}: ¿podrás venir a tu cita de {{producto}} del {{fecha}} a las {{hora}}? Confirma aquí: {{enlace}}" },
    EMAIL: { subject: "¿Podrás venir a tu cita del {{fecha}}?", body: "Hola {{nombre}},\n¿Podrás venir a tu cita de {{producto}} del {{fecha}} a las {{hora}} en {{centro}}?\n\nConfírmanos con un clic:", cta: "Confirmar / No podré ir" },
  },
  noshow_invite: {
    WHATSAPP: { body: "Hola {{nombre}}, tenías una cita de {{producto}} el {{fecha}} en {{centro}} a la que no pudiste asistir. Como no llegó a cancelarse, sigue pendiente.\n\nPuedes reservar un nuevo día aquí:", cta: "Elegir nueva fecha", templateName: "medirenova_recuperacion_noshow" },
    SMS: { body: "{{clinica}}: tu cita de {{producto}} del {{fecha}} sigue pendiente. Elige nueva fecha: {{enlace}}" },
    EMAIL: { subject: "{{clinica}} · Reagenda tu cita de {{producto}}", body: "Hola {{nombre}},\nTenías una cita de {{producto}} el {{fecha}} en {{centro}} a la que no pudiste asistir. Como no llegó a cancelarse, sigue pendiente.\n\nPuedes reservar un nuevo día con el botón:", cta: "Elegir nueva fecha" },
  },
  renewal_reminder: {
    WHATSAPP: { body: "Hola {{nombre}}, tu {{producto}} caduca el {{caduca}}. Reserva tu renovación en un minuto:", cta: "Reservar renovación", templateName: "medirenova_renovacion" },
    SMS: { body: "{{clinica}}: tu {{producto}} caduca el {{caduca}}. Reserva tu renovación: {{enlace}}" },
    EMAIL: { subject: "Tu {{producto}} caduca el {{caduca}}", body: "Hola {{nombre}},\nTu {{producto}} caduca el {{caduca}}. Reserva tu renovación en un minuto con el botón:", cta: "Reservar renovación" },
  },
  portal_access: {
    WHATSAPP: { body: "Hola {{nombre}}, aquí tienes tu acceso a tu área de paciente (válido 60 minutos):", cta: "Entrar en mi área", templateName: "medirenova_acceso_portal" },
    SMS: { body: "{{clinica}}: tu acceso a tu área de paciente (válido 60 min): {{enlace}}" },
    EMAIL: { subject: "Acceso a tu área de paciente · {{clinica}}", body: "Hola {{nombre}},\nHas solicitado acceso a tu área de paciente. Entra desde este botón (válido 60 minutos).\n\nSi no lo has solicitado, ignora este mensaje.", cta: "Entrar en mi área" },
  },
};

export function renderMessage(event: MessagingEvent, channel: Channel, vars: Record<string, string>): ChannelText {
  const t = T[event][channel];
  const out: ChannelText = { body: renderTemplate(t.body, vars) };
  if (t.subject) out.subject = renderTemplate(t.subject, vars);
  if (t.cta) out.cta = t.cta;
  if (t.templateName) out.templateName = t.templateName;
  return out;
}

// Variables de una cita a partir de la fecha "naive" (se guarda con Z pero es
// hora de pared de la clínica): se formatea cortando el ISO, nunca con Date local.
export function appointmentVars(a: {
  scheduledAt: Date;
  product?: { name: string } | null;
  room?: { name: string; center?: { name: string } | null } | null;
}): Record<string, string> {
  const iso = a.scheduledAt.toISOString();
  return {
    producto: a.product?.name ?? "",
    fecha: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`,
    hora: iso.slice(11, 16),
    centro: a.room?.center?.name ?? "",
    sala: a.room?.name ? ` (${a.room.name})` : "",
  };
}
