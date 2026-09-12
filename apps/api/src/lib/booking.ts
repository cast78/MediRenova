import { prisma } from "./prisma.js";
import { nowInTimezone } from "./availability.js";

// Detecta si una cita [start, start+durationMin) solapa con alguna reserva
// existente de la sala (excluyendo CANCELLED/NO_SHOW/RESCHEDULED y, opcionalmente,
// una cita). El índice único anti-double-booking se eliminó: se controla aquí.
export async function roomHasOverlap(
  roomId: string,
  start: Date,
  durationMin: number,
  excludeAppointmentId?: string,
): Promise<boolean> {
  const startMs = start.getTime();
  const endMs = startMs + durationMin * 60_000;
  const window = 6 * 60 * 60_000; // ventana amplia para acotar la consulta
  const candidates = await prisma.appointment.findMany({
    where: {
      roomId,
      status: { notIn: ["CANCELLED", "NO_SHOW", "RESCHEDULED"] },
      scheduledAt: { gte: new Date(startMs - window), lte: new Date(endMs + window) },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { scheduledAt: true, durationMinutes: true },
  });
  return candidates.some((a) => {
    const aStart = a.scheduledAt.getTime();
    const aEnd = aStart + a.durationMinutes * 60_000;
    return startMs < aEnd && endMs > aStart;
  });
}

// ── Regla: 1 reserva activa por (tenant, cliente, producto) ───────────────────
// Un cliente solo puede tener una reserva PENDING/CONFIRMED por producto (en todo
// el tenant, cualquier fecha/centro). Walk-in exento (el paciente ya está presente).

export const BOOKING_GRACE_MS = 2 * 60 * 60_000; // +2h: pasado ese margen, la cita caducó

export type BookingRuleVerdict = "none" | "block" | "expire";

// NÚCLEO PURO: dada la cita activa existente (su instante "wall-clock" en ms) y el
// "ahora" (mismo marco), decide: no hay ninguna ("none"); hay una futura/reciente →
// bloquear ("block"); o caducó hace más del margen → resolver y permitir ("expire").
export function classifyExistingBooking(existingScheduledMs: number | null, nowMs: number, graceMs = BOOKING_GRACE_MS): BookingRuleVerdict {
  if (existingScheduledMs == null) return "none";
  return existingScheduledMs + graceMs < nowMs ? "expire" : "block";
}

export interface SingleBookingResult {
  blockedBy?: { id: string; scheduledAt: Date };  // reserva futura que impide crear otra
  autoResolvedId?: string;                          // caducada auto-cerrada como NO_SHOW
}

// "Ahora" en ms del mismo marco wall-clock-en-Z en que se guarda scheduled_at.
function nowWallMs(tz: string): number {
  const n = nowInTimezone(tz);
  return Date.parse(`${n.date}T00:00:00.000Z`) + n.minutes * 60_000;
}

// Aplica la regla antes de crear una reserva (no walk-in). Si hay una activa futura,
// devuelve `blockedBy` (el llamador responde 409). Si hay una caducada, la marca
// NO_SHOW auto-cerrada y devuelve `autoResolvedId` (se permite crear la nueva).
export async function enforceSingleBooking(tenantId: string, customerId: string, productId: string): Promise<SingleBookingResult> {
  const cfg = await prisma.tenantConfig.findUnique({ where: { tenantId }, select: { timezone: true } });
  const nowMs = nowWallMs(cfg?.timezone ?? "Europe/Madrid");

  const existing = await prisma.appointment.findFirst({
    where: { tenantId, customerId, productId, status: { in: ["PENDING", "CONFIRMED"] }, source: { not: "WALK_IN" } },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "desc" },
  });

  const verdict = classifyExistingBooking(existing ? existing.scheduledAt.getTime() : null, nowMs);
  if (verdict === "none") return {};
  if (verdict === "block") return { blockedBy: existing! };

  await prisma.appointment.update({ where: { id: existing!.id }, data: { status: "NO_SHOW", autoClosed: true } });
  return { autoResolvedId: existing!.id };
}

// Etiqueta corta "DD/MM HH:MM" del instante wall-clock-en-Z de una cita (para mensajes).
export function bookingLabel(d: Date): string {
  const s = d.toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
}
