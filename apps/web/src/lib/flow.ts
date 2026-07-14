// Helpers compartidos de la columna de "flujo" (llegada + tiempos) usados por la
// Lista de Visitas y la Lista de Reservas, para que ambas se vean idénticas.
// Los timestamps de la visita son instantes reales UTC → minsSince/diffMin son
// correctos. La puntualidad compara la hora LOCAL de llegada con la hora de pared
// de la cita (válido para el personal, que está en la zona del centro). Solo HOY
// hay cronómetros vivos (`live`); en pasado, tiempos congelados.
import { Clock, AlarmClock, DoorOpen, Stethoscope, Check, LogOut, type LucideIcon } from "lucide-react";

export const WAIT_ALERT = 20; // min de espera a partir de los que salta la alarma

export interface FlowAppt {
  scheduledAt: string;
  durationMinutes?: number;
  visit?: { arrivedAt?: string | null; startedAt?: string | null; completedAt?: string | null; status?: string } | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const minsSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
export const diffMin = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

export interface Arrival { at: string; delta: number }
export function arrivalInfo(a: FlowAppt): Arrival | null {
  if (!a.visit?.arrivedAt) return null;
  const d = new Date(a.visit.arrivedAt);
  const arrMin = d.getHours() * 60 + d.getMinutes();
  const schedMin = Number(a.scheduledAt.slice(11, 13)) * 60 + Number(a.scheduledAt.slice(14, 16));
  return { at: `${pad(d.getHours())}:${pad(d.getMinutes())}`, delta: arrMin - schedMin };
}

export const CHIP: Record<string, string> = {
  danger: "bg-red-500 text-white",
  warning: "bg-yellow-50 text-yellow-700",
  pro: "bg-indigo-50 text-indigo-700",
  accent: "bg-blue-50 text-blue-700",
  success: "bg-teal-50 text-teal-700",
  muted: "bg-orange-50 text-orange-700",
};
// Icono por semántica del chip (esperando/alarma → reloj; en sala → puerta; etc.).
export const CHIP_ICON: Record<string, LucideIcon> = { danger: AlarmClock, warning: Clock, pro: DoorOpen, accent: Stethoscope, success: Check, muted: LogOut };

export interface Chip { text: string; kind: keyof typeof CHIP }
// Chip de tiempo según el estado del ciclo. `live` (=hoy) activa los cronómetros.
export function flowChip(a: FlowAppt, key: string, live: boolean): Chip | null {
  const v = a.visit;
  if (v?.arrivedAt && v.completedAt) return { text: `Ciclo ${diffMin(v.arrivedAt, v.completedAt)}′`, kind: "success" };
  if (key === "en_espera") {
    if (v?.arrivedAt && live) { const m = minsSince(v.arrivedAt); return { text: `Esperando ${m}′`, kind: m >= WAIT_ALERT ? "danger" : "warning" }; }
    return { text: "En espera", kind: "warning" };
  }
  if (key === "en_sala") return { text: v?.startedAt && live ? `En sala ${minsSince(v.startedAt)}′` : "En sala", kind: "pro" };
  if (key === "en_revision") return { text: v?.startedAt && live ? `Revisión ${minsSince(v.startedAt)}′` : "En revisión", kind: "accent" };
  if (key === "atendida") return { text: "Atendida", kind: "success" };
  if (key === "se_fue") return { text: "Se fue", kind: "muted" };
  return null;
}
// Texto cuando no hay chip (aún sin visita, no presentó, cancelada…). Depende del modo.
export function flowFallback(mode: "hoy" | "pasado" | "futuro", key: string): { text: string; cls: string } {
  if (mode === "futuro") return { text: "Programada", cls: "text-gray-400" };
  if (key === "no_llego" || key === "no_show") return { text: "No se presentó", cls: "text-red-600" };
  if (key === "cancelada" || key === "reprogramada") return { text: "—", cls: "text-gray-300" };
  return { text: "Aún no ha llegado", cls: "text-gray-400" };
}
