import { describe, it, expect } from "vitest";
import { computeDaySlots, productAllowedInRoom } from "../src/lib/availability";

describe("productAllowedInRoom", () => {
  it("permite todos si la lista está vacía", () => {
    expect(productAllowedInRoom([], "p1")).toBe(true);
    expect(productAllowedInRoom(null, "p1")).toBe(true);
  });
  it("respeta la lista de permitidos", () => {
    expect(productAllowedInRoom(["p1", "p2"], "p1")).toBe(true);
    expect(productAllowedInRoom(["p2"], "p1")).toBe(false);
  });
});

// 2026-07-01 es miércoles (getDay = 3) en cualquier zona a medianoche local.
const base = {
  date: "2026-07-01",
  openTime: "09:00",
  closeTime: "11:00",
  slotDuration: 30,
  step: 30,
  booked: [] as { start: number; end: number }[],
};

describe("computeDaySlots (motor de disponibilidad)", () => {
  it("genera slots según horario y duración", () => {
    const slots = computeDaySlots(base);
    expect(slots).toHaveLength(4); // 09:00, 09:30, 10:00, 10:30
    expect(slots[0]).toContain("T09:00:00");
  });

  it("devuelve [] en festivo (5.5)", () => {
    expect(computeDaySlots({ ...base, isHoliday: true })).toEqual([]);
  });

  it("devuelve [] si el día no está activo", () => {
    expect(computeDaySlots({ ...base, activeDays: [1, 2] })).toEqual([]);
  });

  it("excluye slots solapados con reservas", () => {
    const start = new Date("2026-07-01T09:00:00.000Z").getTime();
    const slots = computeDaySlots({ ...base, booked: [{ start, end: start + 30 * 60_000 }] });
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.includes("T09:00:00"))).toBe(false);
  });

  it("respeta la granularidad (step) entre huecos", () => {
    const slots = computeDaySlots({ ...base, step: 60 });
    expect(slots).toHaveLength(2); // cada 60 min: 09:00, 10:00
  });
});
