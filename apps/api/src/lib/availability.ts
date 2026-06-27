// Cálculo de slots disponibles de una sala en un día (motor de disponibilidad).
// Pura y testeable. Considera horario, día activo, festivos y reservas existentes.

export interface BookedInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface DaySlotParams {
  date: string; // YYYY-MM-DD
  openTime: string; // "HH:MM"
  closeTime: string; // "HH:MM"
  activeDays?: number[] | undefined; // 0=Dom … 6=Sáb
  slotDuration: number; // duración de la cita (la marca el producto), para el solape
  step: number; // granularidad entre huecos ofrecidos (config por empresa, 15/30)
  booked: BookedInterval[];
  isHoliday?: boolean;
}

// Un producto está permitido en una sala si la lista de permitidos está vacía
// (= "Todos") o contiene su id. Pura y testeable.
export function productAllowedInRoom(allowedProductIds: unknown, productId: string): boolean {
  const ids = Array.isArray(allowedProductIds) ? (allowedProductIds as string[]) : [];
  return ids.length === 0 || ids.includes(productId);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function computeDaySlots(p: DaySlotParams): string[] {
  if (p.isHoliday) return [];

  const dayOfWeek = new Date(`${p.date}T00:00:00`).getDay();
  if (p.activeDays && !p.activeDays.includes(dayOfWeek)) return [];

  const [openH = 0, openM = 0] = p.openTime.split(":").map(Number);
  const [closeH = 0, closeM = 0] = p.closeTime.split(":").map(Number);
  const step = p.step;
  if (step <= 0) return [];

  const startMin = openH * 60 + openM;
  const totalMinutes = closeH * 60 + closeM - startMin;
  const numSlots = Math.floor(totalMinutes / step);

  const slots: string[] = [];
  for (let i = 0; i < numSlots; i++) {
    const slotMinutes = startMin + i * step;
    const slotH = Math.floor(slotMinutes / 60);
    const slotM = slotMinutes % 60;
    const slotTime = new Date(`${p.date}T${pad(slotH)}:${pad(slotM)}:00.000Z`);
    const slotEnd = slotTime.getTime() + p.slotDuration * 60_000;
    const overlaps = p.booked.some((b) => slotTime.getTime() < b.end && slotEnd > b.start);
    if (!overlaps) slots.push(slotTime.toISOString());
  }
  return slots;
}
