// Regla de reserva única por (cliente, producto): clasificación de la reserva existente.
import { describe, it, expect } from "vitest";
import { classifyExistingBooking, bookingLabel } from "../src/lib/booking";

const ms = (s: string) => Date.parse(`${s}:00.000Z`); // "2026-09-14T09:00" → ms wall-clock

describe("classifyExistingBooking — regla de reserva única", () => {
  const now = ms("2026-09-14T12:00");

  it("sin reserva existente → none", () => {
    expect(classifyExistingBooking(null, now)).toBe("none");
  });
  it("reserva futura → block", () => {
    expect(classifyExistingBooking(ms("2026-09-14T18:00"), now)).toBe("block");
  });
  it("reserva reciente dentro del margen (+2h) → block", () => {
    expect(classifyExistingBooking(ms("2026-09-14T11:00"), now)).toBe("block"); // hace 1h
  });
  it("reserva caducada (pasó hace más de 2h) → expire", () => {
    expect(classifyExistingBooking(ms("2026-09-14T09:00"), now)).toBe("expire"); // hace 3h
  });
  it("justo en el límite del margen sigue bloqueando", () => {
    expect(classifyExistingBooking(ms("2026-09-14T10:00"), now)).toBe("block"); // hace exactamente 2h
  });
  it("el margen es configurable", () => {
    expect(classifyExistingBooking(ms("2026-09-14T11:00"), now, 30 * 60_000)).toBe("expire"); // margen 30min
  });
});

describe("bookingLabel", () => {
  it("formatea DD/MM HH:MM del wall-clock", () => {
    expect(bookingLabel(new Date("2026-09-14T09:30:00.000Z"))).toBe("14/09 09:30");
  });
});
