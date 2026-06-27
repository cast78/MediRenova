// Generación de archivos iCalendar (RFC 5545) para reservas (tarea 9.5). Puro y testeable.

export interface IcsEvent {
  uid: string;
  start: Date;
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string;
  dtstamp?: Date;
}

// Formato UTC compacto: YYYYMMDDTHHMMSSZ
function fmtUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Escape de texto según RFC 5545 (backslash, coma, punto y coma, salto de línea).
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcs(ev: IcsEvent): string {
  const end = new Date(ev.start.getTime() + ev.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MediRenova//CRM//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${fmtUtc(ev.dtstamp ?? ev.start)}`,
    `DTSTART:${fmtUtc(ev.start)}`,
    `DTEND:${fmtUtc(end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
