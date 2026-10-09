// Disparadores de aviso ligados a una cita (crm-mensajeria, Fase 0). Cargan la
// cita con sus relaciones, generan el enlace corto adecuado y llaman a `notify`.
// Nunca lanzan: un fallo al avisar no debe romper la reserva.
import type { MessageDelivery } from "@prisma/client";
import { prisma } from "../prisma.js";
import { notify } from "./notify.js";
import { appointmentVars } from "./templates.js";
import { createConfirmLink, createBookingLink } from "./links.js";
import type { Channel } from "./select-channel.js";

const APPT_INCLUDE = {
  product: { select: { name: true } },
  room: { select: { name: true, center: { select: { name: true } } } },
} as const;

// Cita creada / reprogramada / pedir confirmación → enlace de confirmar o "no podré ir".
export async function notifyAppointment(
  appointmentId: string,
  event: "appointment_created" | "appointment_rescheduled" | "confirmation_requested",
  byUserId?: string | null,
): Promise<{ delivery: MessageDelivery | null; url: string } | null> {
  try {
    const a = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: APPT_INCLUDE });
    if (!a) return null;
    const { url } = await createConfirmLink({ id: a.id, tenantId: a.tenantId, customerId: a.customerId, productId: a.productId });
    const delivery = await notify({
      tenantId: a.tenantId, customerId: a.customerId, appointmentId: a.id, event, link: url,
      vars: appointmentVars(a), byUserId: byUserId ?? null,
    });
    return { delivery, url };
  } catch (err) {
    console.error(`[messaging] notifyAppointment(${event}) falló:`, err);
    return null;
  }
}

// Invitación a reagendar tras un no-show → enlace de auto-reserva del mismo producto.
export async function notifyNoShowInvite(appointmentId: string, byUserId?: string | null, prefer?: Channel[]): Promise<MessageDelivery | null> {
  try {
    const a = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: APPT_INCLUDE });
    if (!a) return null;
    const { url } = await createBookingLink(a.tenantId, a.customerId, a.productId);
    const opts = {
      tenantId: a.tenantId, customerId: a.customerId, appointmentId: a.id, event: "noshow_invite" as const, link: url,
      vars: appointmentVars(a), byUserId: byUserId ?? null,
    };
    return await notify(prefer ? { ...opts, prefer } : opts);
  } catch (err) {
    console.error("[messaging] notifyNoShowInvite falló:", err);
    return null;
  }
}
