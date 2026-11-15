import { describe, it, expect } from "vitest";
import { daysLeft, NOTICE_DAYS } from "../src/lib/trial-expiry.js";

// Mismo criterio que la web (`trialDaysLeft`): techo de los ms restantes. El cron
// corre a las 07:30, así que una prueba que termina a las 00:00 del día D se ve
// como "7 días" el día D-7 por la mañana y "1 día" (mañana) el día D-1.
describe("trial-expiry · daysLeft", () => {
  const until = new Date("2026-11-22T00:00:00.000Z");
  it("7 días por la mañana del día D-7", () => {
    expect(daysLeft(until, new Date("2026-11-15T06:30:00.000Z"))).toBe(7);
  });
  it("6 días al día siguiente (no vuelve a avisar)", () => {
    expect(daysLeft(until, new Date("2026-11-16T06:30:00.000Z"))).toBe(6);
  });
  it("1 día la víspera", () => {
    expect(daysLeft(until, new Date("2026-11-21T06:30:00.000Z"))).toBe(1);
  });
  it("vencida (≤ 0) la mañana del día D", () => {
    expect(daysLeft(until, new Date("2026-11-22T06:30:00.000Z"))).toBeLessThanOrEqual(0);
  });
  it("los avisos son a 7 y 1 días", () => {
    expect([...NOTICE_DAYS]).toEqual([7, 1]);
  });
});
