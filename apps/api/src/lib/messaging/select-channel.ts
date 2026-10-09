// Selección de canal para un aviso al paciente (crm-mensajeria). NÚCLEO PURO,
// sin BD: recorre los canales en orden de preferencia y se queda con el primero
// que esté disponible, tenga medio de contacto en la ficha y consentimiento RGPD.
// Los mensajes de "servicio" (p. ej. acceso al portal pedido por el propio
// paciente) ignoran el consentimiento de marketing, pero no el medio.

export type Channel = "WHATSAPP" | "SMS" | "EMAIL";

export const CHANNEL_LABEL: Record<Channel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

export interface Attempt { channel: Channel; reason: string }

export interface SelectInput {
  prefer: Channel[];
  consent: { whatsapp: boolean; sms: boolean; email: boolean };
  contact: { phone: string | null; email: string | null };
  available: Record<Channel, boolean>;
  service?: boolean;
}

export type SelectResult =
  | { channel: Channel; to: string; tried: Attempt[] }
  | { channel: null; reason: string; tried: Attempt[] };

export function selectChannel(i: SelectInput): SelectResult {
  const tried: Attempt[] = [];
  for (const ch of i.prefer) {
    if (!i.available[ch]) { tried.push({ channel: ch, reason: "canal no disponible" }); continue; }
    const to = ch === "EMAIL" ? i.contact.email : i.contact.phone;
    if (!to || (ch === "EMAIL" && !to.includes("@"))) {
      tried.push({ channel: ch, reason: ch === "EMAIL" ? "sin email en la ficha" : "sin teléfono en la ficha" });
      continue;
    }
    const consent = ch === "WHATSAPP" ? i.consent.whatsapp : ch === "SMS" ? i.consent.sms : i.consent.email;
    if (!i.service && !consent) { tried.push({ channel: ch, reason: "sin consentimiento" }); continue; }
    return { channel: ch, to, tried };
  }
  return { channel: null, reason: describeAttempts(tried), tried };
}

// "WhatsApp: sin consentimiento · SMS: sin teléfono en la ficha"
export function describeAttempts(tried: Attempt[]): string {
  if (tried.length === 0) return "sin canales que probar";
  return tried.map((t) => `${CHANNEL_LABEL[t.channel]}: ${t.reason}`).join(" · ");
}
