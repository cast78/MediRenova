// Cálculo de la fecha de caducidad de un certificado (tarea 6.3).
// Reglas de renovación: o bien una validez simple (`validityDays`), o tramos por
// edad (`ageRules`), donde `validityDays: 0` significa "no permitido".

export interface AgeRule {
  minAge: number;
  maxAge: number;
  validityDays: number;
}

export interface RenewalRules {
  validityDays?: number;
  ageRules?: AgeRule[];
}

// Edad cumplida (en años) en la fecha de referencia.
export function ageAt(birthDate: Date, ref: Date): number {
  let age = ref.getFullYear() - birthDate.getFullYear();
  const m = ref.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birthDate.getDate())) age--;
  return age;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// Devuelve la fecha de caducidad, o null si no se puede determinar o el tramo
// marca "no permitido" (validityDays = 0). Con `ageRules` se exige `birthDate`.
export function calculateExpiryDate(
  birthDate: Date | null | undefined,
  revisionDate: Date,
  rules: RenewalRules | null | undefined,
): Date | null {
  if (!rules) return null;

  if (rules.ageRules && rules.ageRules.length > 0) {
    if (!birthDate) return null;
    const age = ageAt(birthDate, revisionDate);
    const rule = rules.ageRules.find((r) => age >= r.minAge && age <= r.maxAge);
    if (!rule || rule.validityDays <= 0) return null;
    return addDays(revisionDate, rule.validityDays);
  }

  if (rules.validityDays && rules.validityDays > 0) {
    return addDays(revisionDate, rules.validityDays);
  }

  return null;
}
