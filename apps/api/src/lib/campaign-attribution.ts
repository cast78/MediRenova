// Atribución persistida de campañas (crm-captacion fase 2).
// Al crear una reserva, se sella la conversión en el destinatario de la campaña
// last-touch (la más reciente enviada al cliente antes de la cita, dentro de una
// ventana máxima). Mismo patrón que markWorkflowConverted (workflow de caducidades).
import { prisma } from "./prisma.js";

// Ventana máxima que se persiste. La API aplica luego la ventana concreta pedida
// (≤ este máximo) en lectura, así que no tiene sentido sellar conversiones fuera de
// la mayor ventana que ofrece la UI.
export const MAX_ATTRIBUTION_WINDOW_DAYS = 90;

export interface ConversionCandidate {
  recipientId: string;
  sentAt: Date;
}

// NÚCLEO PURO: elige el destinatario a convertir para una cita = la campaña
// last-touch (sentAt más reciente ≤ fecha de la cita) dentro de la ventana máxima.
// Devuelve el recipientId elegido, o null si ninguna campaña aplica.
export function pickCampaignConversion(
  candidates: ConversionCandidate[],
  appointmentCreatedAt: Date,
  maxWindowDays = MAX_ATTRIBUTION_WINDOW_DAYS,
): string | null {
  const apptMs = appointmentCreatedAt.getTime();
  const windowMs = maxWindowDays * 86_400_000;
  let best: { recipientId: string; sentMs: number } | null = null;
  for (const c of candidates) {
    const sentMs = c.sentAt.getTime();
    if (sentMs <= apptMs && apptMs - sentMs <= windowMs && (!best || sentMs > best.sentMs)) {
      best = { recipientId: c.recipientId, sentMs };
    }
  }
  return best?.recipientId ?? null;
}

// Sella la conversión al crear una reserva: busca los destinatarios SENT del cliente
// aún no convertidos (de campañas de su tenant, ya enviadas), elige el last-touch y
// le graba convertedAt + convertedAppointmentId. Idempotente (solo destinatarios
// con convertedAt = null) y no bloqueante (los llamadores usan .catch()).
export async function markCampaignConverted(
  tenantId: string,
  customerId: string,
  appointmentId: string,
  appointmentCreatedAt: Date,
): Promise<void> {
  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      customerId,
      status: "SENT",
      convertedAt: null,
      campaign: { tenantId, sentAt: { not: null } },
    },
    select: { id: true, campaign: { select: { sentAt: true } } },
  });
  const candidates: ConversionCandidate[] = recipients
    .filter((r) => r.campaign.sentAt != null)
    .map((r) => ({ recipientId: r.id, sentAt: r.campaign.sentAt! }));

  const chosen = pickCampaignConversion(candidates, appointmentCreatedAt);
  if (!chosen) return;

  await prisma.campaignRecipient.update({
    where: { id: chosen },
    data: { convertedAt: appointmentCreatedAt, convertedAppointmentId: appointmentId },
  });
}
