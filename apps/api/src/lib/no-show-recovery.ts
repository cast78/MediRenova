// Núcleo puro de la bandeja de recuperación de no-shows (testeable sin BD).

export type RecoveryState = "pending" | "contacted" | "dismissed" | "recovered";

/**
 * Deriva el estado de recuperación de un no-show.
 * Prioridad: "recovered" (el cliente ya tiene una cita nueva del mismo producto tras
 * el no-show) manda sobre el seguimiento manual; si no, el estado guardado; si no hay
 * registro, "pending".
 */
export function deriveRecoveryState(opts: {
  recovered: boolean;
  savedState: "CONTACTED" | "DISMISSED" | null;
}): RecoveryState {
  if (opts.recovered) return "recovered";
  if (opts.savedState === "CONTACTED") return "contacted";
  if (opts.savedState === "DISMISSED") return "dismissed";
  return "pending";
}

/** Tasa de recuperación (recuperadas / total) redondeada a % entero. */
export function recoveryRatio(recovered: number, total: number): number {
  return total === 0 ? 0 : Math.round((recovered / total) * 100);
}
