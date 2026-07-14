"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppContext } from "@/components/context-bar";
import { useAuth } from "@/lib/auth-context";
import { RoomSelect } from "@/components/room-select";
import { estadoDelCiclo, CYCLE_LEGEND, type CycleState } from "@/lib/cycle-state";
import { CHIP, CHIP_ICON, minsSince, arrivalInfo, flowChip, flowFallback } from "@/lib/flow";
import { ArrowUpRight, ArrowRight, UserCircle, Calendar, Stethoscope, DoorOpen, CalendarCheck, UserCheck, ClipboardCheck, ClipboardPlus, Clipboard, ChevronRight, Gauge, UserX, Clock } from "lucide-react";
import { ClientInfoModal } from "@/components/client-info-modal";
import { WalkInModal } from "@/components/walk-in-modal";

interface Center { id: string; name: string }
interface ApptCustomer { id: string; firstName: string | null; lastName: string | null }
interface UAppt {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  customer: ApptCustomer;
  product: { id: string; name: string } | null;
  visit: { id: string; status: string; arrivedAt: string; startedAt: string | null; completedAt: string | null } | null;
  revision: { id: string; outcome: string } | null;
}
interface URoom { id: string; name: string; offeredTimes: string[]; offeredSlots: number; bookedSlots: number; occupancy: number | null; appointments: UAppt[] }
interface UData {
  center: Center;
  date: string;
  rooms: URoom[];
  kpis: { occupancy: number | null; reservas: number; atendidas: number; noShow: number; avgRoomMinutes: number | null; freeSlots: number };
}

const LABEL: Record<string, string> = {
  PENDING: "Pendiente", CONFIRMED: "Confirmada", ATTENDED: "Atendida",
  NO_SHOW: "No presentó", CANCELLED: "Cancelada", RESCHEDULED: "Reprogramada",
};
const BLOCK: Record<string, string> = {
  ATTENDED: "bg-blue-400 border-blue-500",
  CONFIRMED: "bg-emerald-400 border-emerald-500",
  PENDING: "bg-amber-300 border-amber-400",
  NO_SHOW: "bg-red-400 border-red-500",
  CANCELLED: "bg-gray-200 border-gray-300",
  RESCHEDULED: "bg-violet-300 border-violet-400",
};
const STATE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "reservada", label: "Reservada" },
  { key: "atendida", label: "Atendida" },
  { key: "noshow", label: "No presentó" },
  { key: "cancelada", label: "Cancelada" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Hora decimal (hora de pared naïve) desde el ISO de la cita.
const hDec = (iso: string) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
const hhmm = (iso: string) => iso.slice(11, 16);
const custName = (c: ApptCustomer) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
const occPct = (o: number | null) => (o === null ? "—" : `${Math.round(o * 100)}%`);

// Una cita ocupa hueco salvo anulada/reprogramada.
const occupies = (status: string) => status !== "CANCELLED" && status !== "RESCHEDULED";
const hourOf = (t: string) => Number(t.slice(0, 2));

// "Ahora" en hora de pared naíf (para saber si una cita ya pasó).
const nowNaiveIso = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000Z`; };
// Estado del ciclo (reserva+visita+revisión) de una cita.
const cycOf = (a: UAppt, now: string): CycleState => estadoDelCiclo({ apptStatus: a.status, visitStatus: a.visit?.status ?? null, hasRevision: !!a.revision, revisionOutcome: a.revision?.outcome ?? null, isPast: a.scheduledAt <= now });

// Color del mapa de calor por ocupación (una sola rampa azul; gris = no ofertado).
function heatClass(occ: number | null): string {
  if (occ === null) return "bg-gray-50 text-gray-300";
  if (occ === 0) return "bg-blue-50 text-blue-400";
  if (occ <= 0.25) return "bg-blue-100 text-blue-800";
  if (occ <= 0.5) return "bg-blue-200 text-blue-900";
  if (occ <= 0.75) return "bg-blue-400 text-white";
  return "bg-blue-600 text-white";
}

function stateMatch(status: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "reservada") return status === "PENDING" || status === "CONFIRMED";
  if (filter === "atendida") return status === "ATTENDED";
  if (filter === "noshow") return status === "NO_SHOW";
  if (filter === "cancelada") return status === "CANCELLED" || status === "RESCHEDULED";
  return true;
}

const PX_H = 72; // altura en px de una hora en el Timeline vertical (vista de día)

// Trazabilidad de la cita (reserva → visita → revisión). Mismo shape que en Reservas.
interface TimelineEvent { at: string; kind: string; title: string; detail: string; tone: string }
const TL_DOT: Record<string, string> = { book: "bg-gray-400", arrive: "bg-yellow-400", clinic: "bg-teal-500", comm: "bg-sky-500", confirm: "bg-emerald-500", reprog: "bg-violet-500", negative: "bg-red-500" };
const fmtTraceDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function UtilizationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { centers, centerId: ctxCenter } = useAppContext();
  const { user } = useAuth();
  const isClinical = user?.role === "ADMIN" || user?.role === "DOCTOR"; // puede crear revisión
  const centerId = ctxCenter || centers[0]?.id || "";
  // Estado inicial leído de la URL: al volver de una revisión (router.back) se
  // reconstruye la vista tal cual estaba (fecha, pestaña, filtros).
  const qTab = searchParams.get("tab");
  const [date, setDate] = useState(searchParams.get("date") ?? todayLocal());
  const [estado, setEstado] = useState(searchParams.get("estado") ?? "all");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [roomFilter, setRoomFilter] = useState(searchParams.get("room") ?? "");
  const [tab, setTab] = useState<"timeline" | "lista" | "mapa">(
    (["timeline", "lista", "mapa"] as const).includes(qTab as never) ? (qTab as "timeline" | "lista" | "mapa") : "lista",
  );
  const [trace, setTrace] = useState<{ a: UAppt & { roomName: string }; c: CycleState } | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [revBusy, setRevBusy] = useState(false);
  const [revErr, setRevErr] = useState<string | null>(null);
  const qc = useQueryClient();

  // Abre la revisión de una cita creándola si no existe (mismo flujo que "En vivo").
  // Solo se ofrece a rol clínico y para citas atendibles de hoy.
  async function openRevision(apptId: string) {
    setRevBusy(true); setRevErr(null);
    try {
      const res = await apiFetch<{ id: string }>("/revisions", { method: "POST", body: JSON.stringify({ appointmentId: apptId }) })
        .catch((err: unknown) => { if (err instanceof ApiError && err.status === 409) return err.data as { id: string }; throw err; });
      if (res && typeof res === "object" && "id" in res) router.push(`/revisions/${res.id}`);
    } catch (e) {
      const f = e instanceof ApiError && Array.isArray(e.errors) ? (e.errors[0] as { message?: string; code?: string }) : undefined;
      setRevErr(f?.message ?? f?.code ?? "No se pudo abrir la revisión");
    } finally { setRevBusy(false); }
  }

  // Refleja fecha/pestaña/filtros en la URL (reemplaza, sin ensuciar el historial).
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("tab", tab);
    p.set("date", date);
    if (estado !== "all") p.set("estado", estado);
    if (q) p.set("q", q);
    if (roomFilter) p.set("room", roomFilter);
    router.replace(`/visits/utilizacion?${p.toString()}`, { scroll: false });
  }, [tab, date, estado, q, roomFilter, router]);

  // Modo según la fecha elegida: hoy = torre de control en directo; pasado = histórico
  // (tiempos congelados); futuro = agenda (aún no hay visitas, solo reservas).
  const isToday = date === todayLocal();
  const listMode: "hoy" | "pasado" | "futuro" = isToday ? "hoy" : date < todayLocal() ? "pasado" : "futuro";

  const { data, isLoading } = useQuery<UData>({
    queryKey: ["visits-utilization", centerId, date],
    queryFn: () => apiFetch<UData>(`/visits/utilization?centerId=${centerId}&date=${date}`),
    enabled: !!centerId,
    refetchInterval: isToday ? 30_000 : false, // solo hoy: refresca llegadas/estados en vivo
  });

  const rooms = data?.rooms ?? [];
  // Si la sala elegida ya no pertenece al centro/día en pantalla, se resetea.
  useEffect(() => {
    if (roomFilter && !rooms.some((r) => r.id === roomFilter)) setRoomFilter("");
  }, [rooms, roomFilter]);

  // Filtro de sala → acota todas las vistas y los KPIs. El de estado/paciente solo
  // afecta a lo que se MUESTRA (Timeline/Lista), no a los KPIs ni al mapa de calor.
  const roomScoped = roomFilter ? rooms.filter((r) => r.id === roomFilter) : rooms;
  const roomCenters = data ? [{ id: data.center.id, name: data.center.name, rooms: rooms.map((r) => ({ id: r.id, name: r.name })) }] : [];

  const filterAppt = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (a: UAppt) => stateMatch(a.status, estado) && (!needle || custName(a.customer).toLowerCase().includes(needle));
  }, [estado, q]);

  const shownRooms = roomScoped.map((r) => ({ ...r, appointments: r.appointments.filter(filterAppt) }));
  const flat = shownRooms.flatMap((r) => r.appointments.map((a) => ({ ...a, roomName: r.name }))).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  // KPIs recalculados sobre las salas en alcance (todas, o la elegida). Así el
  // resumen se adapta al filtro de sala en vez de mostrar siempre el del centro.
  const kpi = useMemo(() => {
    const offered = roomScoped.reduce((s, r) => s + r.offeredSlots, 0);
    const booked = roomScoped.reduce((s, r) => s + r.bookedSlots, 0);
    const appts = roomScoped.flatMap((r) => r.appointments);
    const durs = appts
      .map((a) => a.visit)
      .filter((v): v is NonNullable<typeof v> => !!v && !!v.startedAt && !!v.completedAt)
      .map((v) => (new Date(v.completedAt as string).getTime() - new Date(v.startedAt as string).getTime()) / 60000)
      .filter((m) => m > 0);
    return {
      occupancy: offered > 0 ? booked / offered : null,
      reservas: appts.filter((a) => occupies(a.status)).length,
      atendidas: appts.filter((a) => a.status === "ATTENDED").length,
      noShow: appts.filter((a) => a.status === "NO_SHOW").length,
      avgRoomMinutes: durs.length ? Math.round(durs.reduce((s, m) => s + m, 0) / durs.length) : null,
    };
  }, [roomScoped]);

  // Rango horario del timeline: 08–20 por defecto, ampliado a las citas del día.
  const allAppts = roomScoped.flatMap((r) => r.appointments);
  let H0 = 8, H1 = 20;
  if (allAppts.length) {
    H0 = Math.min(8, Math.floor(Math.min(...allAppts.map((a) => hDec(a.scheduledAt)))));
    H1 = Math.max(20, Math.ceil(Math.max(...allAppts.map((a) => hDec(a.scheduledAt) + a.durationMinutes / 60))));
  }
  H0 = Math.max(6, H0); H1 = Math.min(23, H1);
  const span = Math.max(1, H1 - H0);
  const hours = Array.from({ length: span + 1 }, (_, i) => H0 + i);
  // Rango del mapa de calor: incluye las horas ofertadas (no solo las reservadas).
  const heatAllH = roomScoped.flatMap((r) => [...r.offeredTimes.map(hourOf), ...r.appointments.map((a) => Number(a.scheduledAt.slice(11, 13)))]);
  let HM0 = 8, HM1 = 20;
  if (heatAllH.length) { HM0 = Math.min(...heatAllH); HM1 = Math.max(...heatAllH) + 1; }
  const heatHours = Array.from({ length: Math.max(1, HM1 - HM0) }, (_, i) => HM0 + i);
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const nowNaive = nowNaiveIso();
  // En modo hoy, quien lleva más rato esperando sube arriba (torre de control); el
  // resto queda cronológico. En pasado/futuro se mantiene el orden por hora.
  const listRows = isToday
    ? [...flat].sort((a, b) => {
        const aw = cycOf(a, nowNaive).key === "en_espera" && !!a.visit?.arrivedAt;
        const bw = cycOf(b, nowNaive).key === "en_espera" && !!b.visit?.arrivedAt;
        if (aw && bw) return minsSince(b.visit!.arrivedAt) - minsSince(a.visit!.arrivedAt);
        if (aw !== bw) return aw ? -1 : 1;
        return a.scheduledAt.localeCompare(b.scheduledAt);
      })
    : flat;
  const shiftDate = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  return (
    <div className="p-6 max-w-5xl">
      {/* Fila superior: título + pestañas (izq) · fecha (der) */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-semibold text-gray-900">Visitas</h1>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            <button onClick={() => router.push("/visits")} className="px-3 py-1.5 text-sm rounded-md font-medium text-gray-500 hover:text-gray-700">Gestión</button>
            <button className="px-3 py-1.5 text-sm rounded-md font-medium bg-white shadow-sm text-gray-900">Utilización</button>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {listMode === "hoy" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
              En directo
            </span>
          ) : listMode === "pasado" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Histórico</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">Agenda</span>
          )}
          <span className="text-sm text-gray-400 capitalize">{dateLabel}</span>
          {centerId && (
            <button onClick={() => setShowWalkIn(true)} className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Nueva visita
            </button>
          )}
        </div>
      </div>

      {/* Filtros: Día/Estado/Paciente (izq) · Sala (der, misma posición que Reservas) */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <Field label="Día">
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDate(-1)} aria-label="Día anterior" className="px-3 py-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors leading-none">‹</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => shiftDate(1)} aria-label="Día siguiente" className="px-3 py-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors leading-none">›</button>
            {!isToday && (
              <button onClick={() => setDate(todayLocal())} className="px-2.5 py-2 text-xs font-medium rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">Hoy</button>
            )}
          </div>
        </Field>
        <Field label="Estado">
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            {STATE_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Paciente"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[200px]" /></Field>
        {rooms.length > 0 && (
          <div className="ml-auto"><Field label="Sala"><RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={setRoomFilter} /></Field></div>
        )}
      </div>

      {/* KPIs (del día; se acotan a la sala elegida si hay filtro) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Kpi icon={Gauge} label="Ocupación media" value={data ? occPct(kpi.occupancy) : "—"} bg="bg-blue-50 border-blue-100" color="text-blue-700" labelColor="text-blue-700" />
        <Kpi icon={CalendarCheck} label="Reservas" value={data ? kpi.reservas : "—"} />
        <Kpi icon={UserCheck} label="Atendidas" value={data ? kpi.atendidas : "—"} bg="bg-violet-50 border-violet-100" color="text-violet-700" labelColor="text-violet-700" />
        <Kpi icon={UserX} label="No presentó" value={data ? kpi.noShow : "—"} bg="bg-red-50 border-red-100" color="text-red-600" labelColor="text-red-600" />
        <Kpi icon={Clock} label="T. medio en sala" value={kpi.avgRoomMinutes != null ? `${kpi.avgRoomMinutes}′` : "—"} bg="bg-teal-50 border-teal-100" color="text-teal-700" labelColor="text-teal-700" />
      </div>

      {/* Sub-pestañas Timeline / Lista */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {([["lista", "Lista"], ["timeline", "Timeline"], ["mapa", "Mapa de calor"]] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>{l}</button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-gray-400">Este centro no tiene salas activas.</p>
      ) : tab === "timeline" ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-x-auto">
          {(() => {
            const bodyH = span * PX_H;
            const nowDec = Number(nowNaive.slice(11, 13)) + Number(nowNaive.slice(14, 16)) / 60;
            const showNow = isToday && nowDec >= H0 && nowDec <= H1;
            return (
              <div className="min-w-[520px]">
                {/* Cabecera: una columna por sala */}
                <div className="flex gap-2 mb-2">
                  <div className="w-12 shrink-0" />
                  {shownRooms.map((r) => (
                    <div key={r.id} className="flex-1 text-center min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{r.name}</div>
                      <div className="text-[11px] text-gray-400">ocupación {occPct(r.occupancy)}</div>
                    </div>
                  ))}
                </div>
                {/* Cuerpo: riel de horas + columnas (el tiempo fluye hacia abajo) */}
                <div className="flex gap-2">
                  <div className="w-12 shrink-0 relative" style={{ height: bodyH }}>
                    {hours.map((h) => (
                      <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] text-gray-400 font-mono" style={{ top: (h - H0) * PX_H }}>{pad(h)}:00</span>
                    ))}
                  </div>
                  {shownRooms.map((r) => (
                    <div key={r.id} className="flex-1 relative rounded-lg border border-gray-200 bg-gray-50/40 min-w-0" style={{ height: bodyH }}>
                      {hours.slice(1).map((h) => (
                        <div key={h} className="absolute left-0 right-0 border-t border-gray-200/70" style={{ top: (h - H0) * PX_H }} />
                      ))}
                      {showNow && (
                        <div className="absolute left-0 right-0 border-t-2 border-red-500 z-20" style={{ top: (nowDec - H0) * PX_H }}>
                          <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-500" />
                        </div>
                      )}
                      {r.appointments.map((a) => {
                        const c = cycOf(a, nowNaive);
                        const top = (hDec(a.scheduledAt) - H0) * PX_H;
                        const hgt = Math.max(20, (a.durationMinutes / 60) * PX_H);
                        return (
                          <button key={a.id} onClick={() => setTrace({ a: { ...a, roomName: r.name }, c })}
                            className={`absolute left-1 right-1 rounded-md overflow-hidden text-left flex items-center border border-black/10 shadow-sm hover:ring-1 hover:ring-gray-400 ${c.cls}`}
                            style={{ top: top + 1, height: Math.max(18, hgt - 2) }}
                            title={`${custName(a.customer)} · ${hhmm(a.scheduledAt)} · ${a.product?.name ?? "—"} · ${c.label}`}>
                            <span className={`absolute left-0 top-0 bottom-0 w-1 ${c.dot}`} />
                            <div className="pl-3 pr-1.5 truncate text-[11px] leading-none flex-1 min-w-0">
                              <span className="text-gray-900 font-medium">{custName(a.customer)}</span>
                              <span className="opacity-80"> · {hhmm(a.scheduledAt)} · {a.product?.name ?? "—"}</span>
                            </div>
                            <span className="shrink-0 pr-2 text-[10px] opacity-70 tabular-nums">{a.durationMinutes}′</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {/* Leyenda */}
                <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-gray-500">
                  {CYCLE_LEGEND.map((c) => <Leg key={c.key} cls={c.dot} label={c.label} />)}
                  {isToday && <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-[2px] bg-red-500" />Ahora</span>}
                </div>
              </div>
            );
          })()}
        </div>
      ) : tab === "lista" ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {listRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">Sin reservas para este filtro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-400 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Hora</th>
                  <th className="text-left font-medium px-4 py-2.5">Paciente</th>
                  <th className="text-left font-medium px-4 py-2.5">{listMode === "futuro" ? "Previsión" : "Espera / tiempo"}</th>
                  <th className="text-left font-medium px-4 py-2.5">Estado</th>
                  <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Resultado</th>
                  <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">Sala</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {listRows.map((a) => {
                  const c = cycOf(a, nowNaive);
                  const chip = flowChip(a, c.key, isToday);
                  const alert = isToday && chip?.kind === "danger";
                  // Fila "en directo": paciente físicamente en curso (en sala / en revisión).
                  const active = isToday && (c.key === "en_sala" || c.key === "en_revision");
                  const arr = arrivalInfo(a);
                  const fb = flowFallback(listMode, c.key);
                  return (
                    <tr key={a.id} onClick={() => setTrace({ a, c })}
                      style={active ? { boxShadow: "inset 3px 0 0 #3b82f6" } : undefined}
                      className={`cursor-pointer ${alert ? "bg-red-50 hover:bg-red-100/60" : active ? "bg-blue-50/50 hover:bg-blue-50" : "hover:bg-gray-50/60"}`}>
                      <td className="px-4 py-2.5 align-top">
                        <div className="font-mono text-blue-700 tabular-nums">{hhmm(a.scheduledAt)}</div>
                        {arr && (
                          <div className={`text-[11px] mt-0.5 ${arr.delta >= 6 ? "text-red-600" : "text-gray-400"}`}>
                            llegó {arr.at}{arr.delta >= 6 ? ` · +${arr.delta}′` : arr.delta <= -6 ? ` · ${arr.delta}′` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <button onClick={(e) => { e.stopPropagation(); setClientId(a.customer.id); }} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 text-left">
                          <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
                          <span className="font-medium text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2">{custName(a.customer)}</span>
                        </button>
                        <div className="text-[11px] text-gray-400 mt-0.5">{a.product?.name ?? "—"} · {a.durationMinutes} min</div>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        {chip ? (() => { const I = CHIP_ICON[chip.kind]; return (
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${CHIP[chip.kind]}`}>
                            {I && <I className="w-3 h-3" />}{chip.text}
                          </span>
                        ); })() : <span className={`text-xs ${fb.cls}`}>{fb.text}</span>}
                      </td>
                      <td className="px-4 py-2.5 align-top"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.cls}`}>{c.label}</span></td>
                      <td className="px-4 py-2.5 align-top hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                        {a.revision ? (
                          <button onClick={() => router.push(`/revisions/${a.revision!.id}`)}
                            className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${a.revision.outcome === "APTO" ? "text-green-600" : a.revision.outcome === "NO_APTO" ? "text-red-600" : "text-gray-500"}`}>
                            {a.revision.outcome === "APTO" ? "Apto" : a.revision.outcome === "NO_APTO" ? "No apto" : "En curso"}
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 align-top text-gray-600 hidden sm:table-cell">{a.roomName}</td>
                      <td className="px-2 py-2.5 align-top text-gray-300">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <div className="overflow-x-auto pb-1">
            <div className="grid gap-px bg-gray-100 rounded-lg overflow-hidden text-xs min-w-[620px]" style={{ gridTemplateColumns: `150px repeat(${heatHours.length}, minmax(34px, 1fr))` }}>
              <div className="bg-white px-3 py-2 font-medium text-gray-400">Sala</div>
              {heatHours.map((h) => <div key={`h${h}`} className="bg-white py-2 text-center text-gray-400">{pad(h)}</div>)}
              {roomScoped.map((r) => (
                <Fragment key={r.id}>
                  <div className="bg-white px-3 py-2 text-gray-600 flex items-center justify-between gap-1">
                    <span className="truncate">{r.name}</span>
                    <span className="text-gray-400 shrink-0">{occPct(r.occupancy)}</span>
                  </div>
                  {heatHours.map((h) => {
                    const offered = r.offeredTimes.filter((t) => hourOf(t) === h).length;
                    const booked = r.appointments.filter((a) => occupies(a.status) && Number(a.scheduledAt.slice(11, 13)) === h).length;
                    const occ = offered > 0 ? Math.min(1, booked / offered) : null;
                    return (
                      <div key={`${r.id}-${h}`} className={`py-2 text-center ${heatClass(occ)}`}
                        title={`${r.name} · ${pad(h)}:00 — ${booked}/${offered} reservados${occ !== null ? ` (${Math.round(occ * 100)}%)` : " (no ofertado)"}`}>
                        {booked > 0 ? booked : ""}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-gray-500">
            <span>Menos</span>
            <span className="w-5 h-4 rounded-sm bg-blue-50 border border-gray-200" />
            <span className="w-5 h-4 rounded-sm bg-blue-100" />
            <span className="w-5 h-4 rounded-sm bg-blue-200" />
            <span className="w-5 h-4 rounded-sm bg-blue-400" />
            <span className="w-5 h-4 rounded-sm bg-blue-600" />
            <span>Más</span>
            <span className="inline-flex items-center gap-1.5 ml-3"><span className="w-4 h-4 rounded-sm bg-gray-50 border border-gray-200" />no ofertado</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Ocupación del día completo por franja horaria (no aplica los filtros de estado/paciente). El número son reservas en esa hora; el color, el % sobre lo ofertado.</p>
        </div>
      )}

      {trace && (
        <TraceModal
          row={trace.a}
          cyc={trace.c}
          onClose={() => { setTrace(null); setRevErr(null); }}
          onOpenReserva={() => router.push(`/appointments?appt=${trace.a.id}`)}
          onOpenRevision={() => { if (trace.a.revision) router.push(`/revisions/${trace.a.revision.id}`); }}
          onAbrirRevision={() => openRevision(trace.a.id)}
          canCreate={isClinical && isToday && !trace.a.revision && (trace.a.status === "CONFIRMED" || trace.a.status === "PENDING")}
          busy={revBusy}
          error={revErr}
        />
      )}
      {clientId && <ClientInfoModal customerId={clientId} onClose={() => setClientId(null)} />}
      {showWalkIn && centerId && (
        <WalkInModal
          centerId={centerId}
          onClose={() => setShowWalkIn(false)}
          onDone={() => { setShowWalkIn(false); void qc.invalidateQueries({ queryKey: ["visits-utilization", centerId, date] }); }}
        />
      )}
    </div>
  );
}

// Estado visual de cada etapa del ciclo (stepper de la cabecera del popup).
const STEP_TONE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  gray: "bg-gray-50 text-gray-400 border border-dashed border-gray-200",
};
function CycleStep({ icon: Icon, label, sub, tone, onClick }: {
  icon: typeof Calendar; label: string; sub: string; tone: string; onClick?: (() => void) | undefined;
}) {
  const cls = `flex-1 min-w-0 rounded-lg px-2 py-2 flex flex-col items-center gap-0.5 text-center ${STEP_TONE[tone]} ${onClick ? "cursor-pointer hover:brightness-95 transition" : ""}`;
  const body = (<><Icon className="w-[18px] h-[18px]" /><span className="text-[11px] font-medium leading-none">{label}</span><span className="text-[10px] opacity-80 leading-none truncate max-w-full">{sub}</span></>);
  return onClick ? <button onClick={onClick} title={`Ir a ${label.toLowerCase()}`} className={cls}>{body}</button> : <div className={cls}>{body}</div>;
}

// Popup de trazabilidad reserva → visita → revisión (mismo timeline que en Reservas).
// Cabecera con stepper del ciclo (etapas clicables) y pie con acciones a Reserva/Revisión.
function TraceModal({ row, cyc, onClose, onOpenReserva, onOpenRevision, onAbrirRevision, canCreate, busy, error }: {
  row: UAppt & { roomName: string }; cyc: CycleState; onClose: () => void;
  onOpenReserva: () => void; onOpenRevision: () => void; onAbrirRevision: () => void;
  canCreate: boolean; busy: boolean; error: string | null;
}) {
  const [showClient, setShowClient] = useState(false);
  // Etapa Visita: estado según el episodio físico.
  const vis = row.visit?.status;
  const visStep = !row.visit ? { sub: "sin llegada", tone: "gray" }
    : vis === "WAITING" ? { sub: "en espera", tone: "amber" }
    : vis === "IN_PROGRESS" ? { sub: "en sala", tone: "blue" }
    : vis === "COMPLETED" ? { sub: "atendida", tone: "green" }
    : vis === "LEFT" ? { sub: "se fue", tone: "red" }
    : { sub: "—", tone: "gray" };
  // Etapa Revisión: estado según el resultado (o sin abrir).
  const rev = row.revision?.outcome;
  const revStep = !row.revision ? { icon: Clipboard, sub: "sin abrir", tone: "gray" }
    : rev === "APTO" ? { icon: ClipboardCheck, sub: "apto", tone: "green" }
    : rev === "NO_APTO" ? { icon: ClipboardCheck, sub: "no apto", tone: "red" }
    : { icon: ClipboardCheck, sub: "en curso", tone: "blue" };
  // Etapa Reserva: verde salvo cerrada en negativo.
  const resTone = row.status === "CANCELLED" || row.status === "NO_SHOW" || row.status === "RESCHEDULED" ? "gray" : "green";
  const { data: trace, isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["appt-timeline", row.id],
    queryFn: () => apiFetch<TimelineEvent[]>(`/appointments/${row.id}/timeline`),
  });
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera con el contexto del paciente + estado del ciclo */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <button onClick={() => setShowClient(true)} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 text-left min-w-0">
              <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-[15px] font-semibold text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2 truncate">{custName(row.customer)}</span>
            </button>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-gray-400" />{hhmm(row.scheduledAt)}</span>
              <span className="inline-flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5 text-gray-400" />{row.product?.name ?? "—"} · {row.durationMinutes} min</span>
              <span className="inline-flex items-center gap-1.5"><DoorOpen className="w-3.5 h-3.5 text-gray-400" />{row.roomName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cyc.cls}`}>{cyc.label}</span>
            <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>
        {/* Stepper del ciclo: Reserva y Revisión enlazan a su módulo; Visita es informativa */}
        <div className="flex items-stretch gap-1.5 px-5 py-3 bg-gray-50/60 border-b border-gray-100">
          <CycleStep icon={CalendarCheck} label="Reserva" sub={LABEL[row.status] ?? row.status} tone={resTone} onClick={onOpenReserva} />
          <span className="flex items-center text-gray-300"><ChevronRight className="w-4 h-4" /></span>
          <CycleStep icon={UserCheck} label="Visita" sub={visStep.sub} tone={visStep.tone} />
          <span className="flex items-center text-gray-300"><ChevronRight className="w-4 h-4" /></span>
          <CycleStep icon={revStep.icon} label="Revisión" sub={revStep.sub} tone={revStep.tone} onClick={row.revision ? onOpenRevision : undefined} />
        </div>
        <div className="p-5">
        <p className="text-xs text-gray-400 mb-3">Trazabilidad — reserva · visita · revisión</p>
        {isLoading ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : !trace || trace.length === 0 ? (
          <p className="text-sm text-gray-400">Sin eventos registrados.</p>
        ) : (
          <ol className="relative border-l border-gray-200 ml-1 space-y-3">
            {trace.map((e, i) => (
              <li key={i} className="ml-4">
                <span className={`absolute -left-[4px] mt-1 w-2 h-2 rounded-full ${TL_DOT[e.tone] ?? "bg-gray-400"}`} />
                <p className="text-xs font-medium text-gray-800">{e.title}</p>
                {e.detail && <p className="text-[11px] text-gray-500">{e.detail}</p>}
                <p className="text-[10px] text-gray-400 capitalize">{fmtTraceDate(e.at)}</p>
              </li>
            ))}
          </ol>
        )}
        </div>
        {/* Pie de acciones: ir a la reserva y a la revisión (o abrirla) */}
        {error && <p className="text-xs text-red-600 px-5 -mt-2 mb-2">{error}</p>}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60">
          <span className="text-[11px] text-gray-400 mr-auto">Ir a…</span>
          <button onClick={onOpenReserva} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-white transition-colors">
            <Calendar className="w-3.5 h-3.5" />Ver reserva
          </button>
          {row.revision ? (
            <button onClick={onOpenRevision}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${row.revision.outcome === "APTO" ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : row.revision.outcome === "NO_APTO" ? "border-red-200 text-red-700 hover:bg-red-50" : "border-blue-200 text-blue-700 hover:bg-blue-50"}`}>
              <ClipboardCheck className="w-3.5 h-3.5" />Ver revisión<ArrowUpRight className="w-3 h-3" />
            </button>
          ) : canCreate ? (
            <button disabled={busy} onClick={onAbrirRevision}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 font-medium transition-colors disabled:opacity-50">
              <ClipboardPlus className="w-3.5 h-3.5" />Abrir revisión<ArrowRight className="w-3 h-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
    {showClient && <ClientInfoModal customerId={row.customer.id} onClose={() => setShowClient(false)} />}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label>{children}</div>;
}
function Kpi({ icon: Icon, label, value, bg = "bg-white border-gray-200", color = "text-gray-900", labelColor = "text-gray-500" }: {
  icon: typeof Calendar; label: string; value: string | number; bg?: string; color?: string; labelColor?: string;
}) {
  return (
    <div className={`border rounded-xl px-4 py-3 ${bg}`}>
      <p className={`text-xs flex items-center gap-1.5 ${labelColor}`}><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
function Leg({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${cls}`} />{label}</span>;
}
