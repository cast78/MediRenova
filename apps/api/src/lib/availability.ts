// Cálculo de slots disponibles de una sala en un día (motor de disponibilidad).
// Modelo de huecos explícitos por día de la semana: cada sala define qué horas
// concretas ofrece cada día (no un rango lineal apertura-cierre). Pura y testeable.

export interface BookedInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

// schedule.slotsByDay: { "0": ["07:00", ...], "1": [...], ... }  (0=Dom … 6=Sáb)
export type SlotsByDay = Record<string, string[]>;

export interface DaySlotParams {
  date: string; // YYYY-MM-DD
  slotsByDay: SlotsByDay | undefined;
  slotDuration: number; // duración de la cita (la marca el producto), para el solape
  booked: BookedInterval[];
  isHoliday?: boolean;
  // "Ahora" en la zona horaria del centro. Si la fecha coincide con now.date, se
  // ocultan los huecos cuya hora sea <= now.minutes (ya pasados hoy).
  now?: { date: string; minutes: number };
  // Antelación mínima de reserva (min). Oculta hoy los huecos a menos de X min de ahora.
  leadMinutes?: number;
}

// Devuelve la fecha (YYYY-MM-DD) y los minutos del día actuales en una zona horaria.
export function nowInTimezone(tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // en-CA da la hora "24" a medianoche; normalizamos a "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(hour) * 60 + Number(get("minute")) };
}

// Un producto está permitido en una sala si la lista de permitidos está vacía
// (= "Todos") o contiene su id. Pura y testeable.
export function productAllowedInRoom(allowedProductIds: unknown, productId: string): boolean {
  const ids = Array.isArray(allowedProductIds) ? (allowedProductIds as string[]) : [];
  return ids.length === 0 || ids.includes(productId);
}

export function computeDaySlots(p: DaySlotParams): string[] {
  if (p.isHoliday) return [];

  const dayOfWeek = new Date(`${p.date}T00:00:00`).getDay();
  const times = p.slotsByDay?.[String(dayOfWeek)] ?? [];

  // Minutos desde la medianoche de "hoy" hasta la medianoche de este día (0 hoy,
  // 1440 mañana, …). Permite aplicar "pasados" + antelación mínima a través de días.
  const dayOffsetMin = p.now
    ? Math.round((new Date(`${p.date}T00:00:00Z`).getTime() - new Date(`${p.now.date}T00:00:00Z`).getTime()) / 60_000)
    : 0;

  const slots: string[] = [];
  for (const t of times) {
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    // Oculta huecos ya pasados y los que no cumplen la antelación mínima (zona del centro).
    if (p.now) {
      const [hh, mm] = t.split(":").map(Number);
      const slotFromTodayMidnight = dayOffsetMin + (hh ?? 0) * 60 + (mm ?? 0);
      if (slotFromTodayMidnight <= p.now.minutes + (p.leadMinutes ?? 0)) continue;
    }
    const slotTime = new Date(`${p.date}T${t}:00.000Z`);
    const start = slotTime.getTime();
    const end = start + p.slotDuration * 60_000;
    const overlaps = p.booked.some((b) => start < b.end && end > b.start);
    if (!overlaps) slots.push(slotTime.toISOString());
  }
  return slots.sort();
}
