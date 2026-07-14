import { prisma } from "./prisma.js";

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
