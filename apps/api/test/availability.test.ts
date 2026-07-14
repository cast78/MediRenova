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
  slotsByDay: { "3": ["09:00", "09:30", "10:00", "10:30"] } as Record<string, string[]>,
  slotDuration: 30,
  booked: [] as { start: number; end: number }[],
};

describe("computeDaySlots (motor de disponibilidad)", () => {
  it("genera un slot por cada hueco definido del día", () => {
    const slots = computeDaySlots(base);
    expect(slots).toHaveLength(4); // 09:00, 09:30, 10:00, 10:30
    expect(slots[0]).toContain("T09:00:00");
  });

  it("devuelve [] en festivo (5.5)", () => {
    expect(computeDaySlots({ ...base, isHoliday: true })).toEqual([]);
  });

  it("devuelve [] si el día no tiene huecos definidos", () => {
    expect(computeDaySlots({ ...base, slotsByDay: { "1": ["09:00"] } })).toEqual([]);
  });

  it("devuelve [] si slotsByDay es undefined", () => {
    expect(computeDaySlots({ ...base, slotsByDay: undefined })).toEqual([]);
  });

  it("excluye slots solapados con reservas", () => {
    const start = new Date("2026-07-01T09:00:00.000Z").getTime();
    const slots = computeDaySlots({ ...base, booked: [{ start, end: start + 30 * 60_000 }] });
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.includes("T09:00:00"))).toBe(false);
  });

  it("oculta los huecos ya pasados hoy (zona del centro)", () => {
    // now = misma fecha, 10:00 (600 min) → 09:00 y 10:00 fuera, 10:30 dentro.
    const slots = computeDaySlots({ ...base, now: { date: base.date, minutes: 600 } });
    expect(slots.some((s) => s.includes("T09:00:00"))).toBe(false);
    expect(slots.some((s) => s.includes("T10:00:00"))).toBe(false);
    expect(slots.some((s) => s.includes("T10:30:00"))).toBe(true);
  });

  it("no filtra por hora si la fecha no es hoy", () => {
    // now en otra fecha → no se descarta ningún hueco por hora.
    const slots = computeDaySlots({ ...base, now: { date: "2026-07-02", minutes: 1439 } });
    expect(slots).toHaveLength(4);
  });

  it("solo ofrece los huecos elegidos por el centro (no lineal)", () => {
    const slots = computeDaySlots({ ...base, slotsByDay: { "3": ["09:00", "13:00", "18:30"] } });
    expect(slots).toHaveLength(3);
    expect(slots[0]).toContain("T09:00:00");
    expect(slots[1]).toContain("T13:00:00");
    expect(slots[2]).toContain("T18:30:00");
  });
});
