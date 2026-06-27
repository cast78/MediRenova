import { describe, it, expect } from "vitest";
import { ageAt, addDays, calculateExpiryDate, type RenewalRules } from "../src/lib/expiry";

describe("ageAt", () => {
  it("calcula edad cumplida considerando mes/día", () => {
    const birth = new Date("1980-06-15");
    expect(ageAt(birth, new Date("2026-06-15"))).toBe(46); // cumple ese día
    expect(ageAt(birth, new Date("2026-06-14"))).toBe(45); // un día antes
    expect(ageAt(birth, new Date("2026-12-31"))).toBe(46);
  });
});

describe("addDays", () => {
  it("suma días sin mutar el original", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const r = addDays(d, 31);
    expect(r.getTime()).toBeGreaterThan(d.getTime());
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

// Reglas tipo DGT (validez en días). 10/5/2 años aprox.
const DGT: RenewalRules = {
  ageRules: [
    { minAge: 0, maxAge: 64, validityDays: 3650 },
    { minAge: 65, maxAge: 70, validityDays: 1825 },
    { minAge: 71, maxAge: 120, validityDays: 730 },
  ],
};

describe("calculateExpiryDate", () => {
  const revision = new Date("2026-06-27T00:00:00Z");

  it("usa el tramo de edad correspondiente (joven → 10 años)", () => {
    const birth = new Date("1990-01-01");
    const exp = calculateExpiryDate(birth, revision, DGT)!;
    expect(exp).toEqual(addDays(revision, 3650));
  });

  it("usa el tramo de mayores (72 años → 2 años)", () => {
    const birth = new Date("1954-01-01"); // 72 en 2026
    const exp = calculateExpiryDate(birth, revision, DGT)!;
    expect(exp).toEqual(addDays(revision, 730));
  });

  it("devuelve null si hay ageRules pero falta birthDate", () => {
    expect(calculateExpiryDate(null, revision, DGT)).toBeNull();
  });

  it("respeta validityDays=0 como 'no permitido' → null", () => {
    const rules: RenewalRules = { ageRules: [{ minAge: 0, maxAge: 120, validityDays: 0 }] };
    expect(calculateExpiryDate(new Date("2000-01-01"), revision, rules)).toBeNull();
  });

  it("usa validez simple cuando no hay tramos", () => {
    const exp = calculateExpiryDate(new Date("1990-01-01"), revision, { validityDays: 1825 })!;
    expect(exp).toEqual(addDays(revision, 1825));
  });

  it("devuelve null sin reglas", () => {
    expect(calculateExpiryDate(new Date("1990-01-01"), revision, null)).toBeNull();
    expect(calculateExpiryDate(new Date("1990-01-01"), revision, {})).toBeNull();
  });
});
