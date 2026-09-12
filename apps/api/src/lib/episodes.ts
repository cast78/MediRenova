// ── Episodios sin cerrar ──────────────────────────────────────────────────────
// Complementa la regla de reserva única (booking.ts): aquel barrido cierra como
// NO_SHOW las citas pasadas SIN visita (el paciente no llegó). Aquí gestionamos el
// caso opuesto: citas pasadas CON visita (el paciente llegó) cuyo episodio no
// alcanzó desenlace. La Visit es la fuente de verdad de "vino o no"; el estado de
// la cita, no. Ver openspec/changes/crm-episodios-sin-cerrar.

// Estado "atascado" que se muestra en el panel. `null` = el episodio está resuelto
// (o no es un episodio) y NO aparece en el panel.
export type StuckEpisode = "espero" | "en_sala" | "revision_a_medias";

// Etiqueta legible por estado atascado (ES).
export const STUCK_LABELS: Record<StuckEpisode, string> = {
  espero: "Esperó sin ser atendido",
  en_sala: "En sala sin revisión",
  revision_a_medias: "Revisión a medias",
};

// Estados terminales de una visita: el episodio ya está resuelto.
const VISIT_TERMINAL = ["COMPLETED", "LEFT", "CANCELLED"];

export interface EpisodeVisit {
  status: string;
}
export interface EpisodeRevision {
  completedAt: Date | string | null;
}

/**
 * NÚCLEO PURO (sin BD): clasifica el estado atascado de un episodio a partir de su
 * visita y su revisión. Devuelve `null` cuando NO es un episodio sin cerrar:
 *  - no hay visita (el paciente no llegó → es no-show/cancelar en la worklist de reservas),
 *  - la visita ya es terminal (COMPLETED/LEFT/CANCELLED), o
 *  - la revisión ya está completada.
 *
 * Precedencia: primero descarta lo resuelto; una revisión iniciada sin completar
 * manda sobre el estado de la visita ("revisión a medias").
 */
export function classifyStuckEpisode(
  visit: EpisodeVisit | null | undefined,
  revision: EpisodeRevision | null | undefined,
): StuckEpisode | null {
  if (!visit) return null; // sin visita → no es un episodio (worklist de reservas)
  if (VISIT_TERMINAL.includes(visit.status)) return null; // visita resuelta
  if (revision && revision.completedAt != null) return null; // clínicamente cerrada
  if (revision) return "revision_a_medias"; // revisión iniciada sin completar
  if (visit.status === "WAITING") return "espero";
  if (visit.status === "IN_PROGRESS") return "en_sala";
  return null;
}

// Antigüedad en días NATURALES entre el día de la cita y hoy (ambos en convenio
// naïve "hora de pared en Z": se compara la fecha, no la hora). Nunca negativa.
export function episodeAgeDays(scheduledAt: Date, now: Date): number {
  const DAY = 24 * 60 * 60_000;
  const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.floor((dayStart(now) - dayStart(scheduledAt)) / DAY);
  return diff < 0 ? 0 : diff;
}

// ② "Cerrada fuera de plazo": true si la revisión se completó en un día NATURAL
// posterior al de la cita. No altera el desenlace clínico; solo marca el retraso.
export function isClosedLate(scheduledAt: Date, completedAt: Date): boolean {
  return episodeAgeDays(scheduledAt, completedAt) > 0;
}
