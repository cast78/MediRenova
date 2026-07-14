// Estado del ciclo del paciente = una sola verdad derivada de las TRES capas
// (reserva + visita + revisión). Antes de llegar refleja la reserva; al llegar, la
// visita; al examinarse, la revisión. Fuente única de etiquetas y colores para todas
// las interfaces (Reservas, Visitas/Utilización, Consulta).

export interface CycleInput {
  apptStatus: string; // PENDING | CONFIRMED | ATTENDED | CANCELLED | RESCHEDULED | NO_SHOW
  visitStatus?: string | null; // WAITING | IN_PROGRESS | COMPLETED | LEFT | CANCELLED
  hasRevision?: boolean; // ¿existe revisión abierta?
  revisionOutcome?: string | null; // PENDING | APTO | NO_APTO
  isPast?: boolean; // opcional: si la hora ya pasó (para distinguir "No llegó")
}

export interface CycleState {
  key: string;
  label: string;
  cls: string; // fondo+texto de píldora
  dot: string; // color del punto
  solid: string; // color sólido (barras de timeline)
}

const S: Record<string, CycleState> = {
  reservada: { key: "reservada", label: "Pendiente", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500", solid: "bg-amber-400 border-amber-500" },
  confirmada: { key: "confirmada", label: "Confirmada", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", solid: "bg-emerald-400 border-emerald-500" },
  enEspera: { key: "en_espera", label: "En espera", cls: "bg-yellow-50 text-yellow-700", dot: "bg-yellow-400", solid: "bg-yellow-300 border-yellow-400" },
  enSala: { key: "en_sala", label: "En sala", cls: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500", solid: "bg-indigo-400 border-indigo-500" },
  enRevision: { key: "en_revision", label: "En revisión", cls: "bg-blue-50 text-blue-700", dot: "bg-blue-500", solid: "bg-blue-400 border-blue-500" },
  atendida: { key: "atendida", label: "Atendida", cls: "bg-violet-50 text-violet-700", dot: "bg-violet-500", solid: "bg-violet-400 border-violet-500" },
  seFue: { key: "se_fue", label: "Se fue", cls: "bg-orange-50 text-orange-700", dot: "bg-orange-500", solid: "bg-orange-300 border-orange-400" },
  noLlego: { key: "no_llego", label: "No llegó", cls: "bg-red-50 text-red-700", dot: "bg-red-500", solid: "bg-red-300 border-red-400" },
  noShow: { key: "no_show", label: "No presentó", cls: "bg-red-50 text-red-700", dot: "bg-red-500", solid: "bg-red-400 border-red-500" },
  cancelada: { key: "cancelada", label: "Cancelada", cls: "bg-gray-100 text-gray-500", dot: "bg-gray-400", solid: "bg-gray-200 border-gray-300" },
  reprogramada: { key: "reprogramada", label: "Reprogramada", cls: "bg-slate-100 text-slate-700", dot: "bg-slate-500", solid: "bg-slate-300 border-slate-400" },
};

export function estadoDelCiclo(i: CycleInput): CycleState {
  const st = i.apptStatus;
  const done = i.revisionOutcome === "APTO" || i.revisionOutcome === "NO_APTO";
  // 1) Terminales administrativos de la RESERVA.
  if (st === "CANCELLED") return S.cancelada!;
  if (st === "RESCHEDULED") return S.reprogramada!;
  // 2) Atendida (clínica completada) — mandaría sobre todo lo demás.
  if (st === "ATTENDED" || done || i.visitStatus === "COMPLETED") return S.atendida!;
  // 3) "Se fue": llegó y se marchó. Va ANTES de No presentó: aunque la reserva se
  //    cierre como NO_SHOW, el matiz es que sí vino (recuperable).
  if (i.visitStatus === "LEFT" || i.visitStatus === "CANCELLED") return S.seFue!;
  // 4) No presentó: nunca llegó.
  if (st === "NO_SHOW") return S.noShow!;
  // 4) Progreso clínico / físico (la visita/revisión mandan sobre el estado de reserva).
  if (i.hasRevision || i.revisionOutcome === "PENDING") return S.enRevision!;
  if (i.visitStatus === "IN_PROGRESS") return S.enSala!;
  if (i.visitStatus === "WAITING") return S.enEspera!;
  // 5) Sin llegada: estado administrativo de la reserva (con matiz de "No llegó" si ya pasó).
  if (i.isPast === true) return S.noLlego!;
  if (st === "CONFIRMED") return S.confirmada!;
  return S.reservada!;
}

// Leyenda canónica (para pintar la referencia de colores igual en todas partes).
export const CYCLE_LEGEND: CycleState[] = [S.confirmada!, S.enEspera!, S.enSala!, S.enRevision!, S.atendida!, S.noLlego!, S.cancelada!];
