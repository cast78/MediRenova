import { prisma } from "./prisma.js";
import { nowInTimezone } from "./availability.js";
import { BOOKING_GRACE_MS } from "./booking.js";

// Barrido de reservas caducadas (regla de reserva única).
// Marca como NO_SHOW auto-cerradas las citas PENDING/CONFIRMED cuya hora pasó hace más
// del margen (+2h) y que NO tienen visita asociada (el paciente no llegó). Walk-in
// excluido (su hora es "ahora"). Así se libera al cliente para volver a reservar y la
// analítica de no-show refleja la realidad. Excluir "con visita" evita marcar como
// no-show a quien sí acudió (aunque no se cerrara la revisión).
export async function sweepExpiredAppointments(tz = "Europe/Madrid"): Promise<number> {
  const n = nowInTimezone(tz);
  const nowMs = Date.parse(`${n.date}T00:00:00.000Z`) + n.minutes * 60_000;
  const threshold = new Date(nowMs - BOOKING_GRACE_MS);

  const stale = await prisma.appointment.findMany({
    where: {
      status: { in: ["PENDING", "CONFIRMED"] },
      source: { not: "WALK_IN" },
      scheduledAt: { lt: threshold },
      visit: { is: null },
    },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  await prisma.appointment.updateMany({
    where: { id: { in: stale.map((a) => a.id) } },
    data: { status: "NO_SHOW", autoClosed: true },
  });
  return stale.length;
}
