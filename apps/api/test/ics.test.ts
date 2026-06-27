import { describe, it, expect } from "vitest";
import { buildIcs } from "../src/lib/ics";

describe("buildIcs (RFC 5545, tarea 9.5)", () => {
  const ev = {
    uid: "appt-1@medirenova",
    start: new Date("2026-07-01T09:30:00.000Z"),
    durationMinutes: 30,
    summary: "Cita: Carnet B",
    description: "Reconocimiento — Juan, Pérez",
    location: "Centro; Calle, 1",
    dtstamp: new Date("2026-06-27T10:00:00.000Z"),
  };

  it("genera VCALENDAR/VEVENT con fechas UTC", () => {
    const ics = buildIcs(ev);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:appt-1@medirenova");
    expect(ics).toContain("DTSTART:20260701T093000Z");
    expect(ics).toContain("DTEND:20260701T100000Z"); // +30 min
    expect(ics).toContain("DTSTAMP:20260627T100000Z");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapa comas y puntos y coma en los textos", () => {
    const ics = buildIcs(ev);
    expect(ics).toContain("LOCATION:Centro\\; Calle\\, 1");
    expect(ics).toContain("DESCRIPTION:Reconocimiento — Juan\\, Pérez");
  });

  it("usa CRLF entre líneas", () => {
    expect(buildIcs(ev)).toContain("\r\n");
  });
});
