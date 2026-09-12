import { prisma } from "./prisma.js";
import { nowInTimezone } from "./availability.js";

// Días de gracia antes de que el sistema cierre automáticamente una cita pasada.
// Damos margen a recepción para resolverla a mano desde la pestaña "Sin cerrar"
// (registrar revisión / no-show / cancelar). Pasado el margen, el barrido cierra las
// que quedan abandonadas. NO se confunde con la regla de reserva única, que usa su
// propio margen corto (BOOKING_GRACE_MS, +2h) para el desbloqueo al reservar.
export const SWEEP_GRACE_DAYS = 2;

// Barrido de reservas caducadas abandonadas.
// Marca NO_SHOW (auto-cerradas) las citas PENDING/CONFIRMED de hace más de
// SWEEP_GRACE_DAYS días, sin walk-in y SIN visita (el paciente no llegó). Excluir "con
// visita" evita marcar no-show a quien sí acudió aunque no se cerrara la revisión.
export async function sweepExpiredAppointments(tz = "Europe/Madrid"): Promise<number> {
  const n = nowInTimezone(tz);
  const todayStartMs = Date.parse(`${n.date}T00:00:00.000Z`);
  const threshold = new Date(todayStartMs - SWEEP_GRACE_DAYS * 86_400_000);

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
