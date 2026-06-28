// Validación de la letra de control del DNI/NIE español (tarea 8.2). Pura y testeable.
import { createHash } from "node:crypto";

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

// Hash determinista del DNI (para deduplicar sin almacenar el DNI en claro).
export function hashDni(dni: string): string {
  return createHash("sha256").update(dni.toUpperCase().trim()).digest("hex");
}

export function validateSpanishDni(dni: string): boolean {
  const clean = dni.toUpperCase().trim();
  const nieMap: Record<string, string> = { X: "0", Y: "1", Z: "2" };
  let normalized = clean;
  if (normalized[0] && nieMap[normalized[0]]) {
    normalized = nieMap[normalized[0]]! + normalized.slice(1);
  }
  const match = normalized.match(/^(\d{8})([A-Z])$/);
  if (!match) return false;
  const num = parseInt(match[1]!, 10);
  const letter = match[2]!;
  return DNI_LETTERS[num % 23] === letter;
}
