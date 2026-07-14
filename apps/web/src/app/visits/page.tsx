"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppContext } from "@/components/context-bar";
import { RoomSelect } from "@/components/room-select";
import { WalkInModal } from "@/components/walk-in-modal";
import { estadoDelCiclo } from "@/lib/cycle-state";
import { ClientInfoModal } from "@/components/client-info-modal";
import { Calendar, Stethoscope, DoorOpen, UserCircle, Armchair, Hourglass, CheckCircle2, Clock, Undo2 } from "lucide-react";

interface Center { id: string; name: string }
interface Room { id: string; name: string }
interface VisitCustomer { id: string; firstName: string | null; lastName: string | null }
interface Visit {
  id: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "LEFT" | "CANCELLED";
  arrivedAt: string;
  calledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  currentRoomId: string | null;
  customer: VisitCustomer;
  currentRoom: Room | null;
  appointment: { id: string; scheduledAt: string; durationMinutes: number; status: string; product: { id: string; name: string } | null; room: Room | null } | null;
  revision: { id: string; outcome: string } | null;
}
interface Board {
  center: Center;
  date: string;
  rooms: Room[];
  visits: Visit[];
  kpis: { waiting: number; inProgress: number; completedToday: number; avgWaitMinutes: number };
  waitThresholds: { amber: number; red: number };
}

const name = (c: VisitCustomer) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
const initials = (c: VisitCustomer) => ((c.firstName?.[0] ?? "") + (c.lastName?.[0] ?? "")).toUpperCase() || "?";
const minsSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)) : 0);

// Semáforo de espera: verde por debajo del ámbar, ámbar hasta el rojo, rojo por encima.
function waitPillClass(mins: number, t: { amber: number; red: number }) {
  if (mins > t.red) return "bg-red-50 text-red-700";
  if (mins >= t.amber) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function apptErr(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Array.isArray(e.errors) ? (e.errors[0] as { message?: string; code?: string }) : undefined;
    return first?.message ?? first?.code ?? `Error ${e.status}`;
  }
  return "Error inesperado";
}

const hhmm = (iso: string) => iso.slice(11, 16);

// Trazabilidad (reserva → visita → revisión). Mismo shape y estilo que en Utilización.
interface TimelineEvent { at: string; kind: string; title: string; detail: string; tone: string }
const TL_DOT: Record<string, string> = { book: "bg-gray-400", arrive: "bg-yellow-400", clinic: "bg-teal-500", comm: "bg-sky-500", confirm: "bg-emerald-500", reprog: "bg-violet-500", negative: "bg-red-500" };
const fmtTraceDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function VisitTraceModal({ v, onClose }: { v: Visit; onClose: () => void }) {
  const [showClient, setShowClient] = useState(false);
  const apptId = v.appointment?.id;
  const { data: trace, isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["appt-timeline", apptId],
    queryFn: () => apiFetch<TimelineEvent[]>(`/appointments/${apptId}/timeline`),
    enabled: !!apptId,
  });
  const cyc = estadoDelCiclo({ apptStatus: v.appointment?.status ?? "CONFIRMED", visitStatus: v.status, hasRevision: !!v.revision, revisionOutcome: v.revision?.outcome ?? null });
  const room = v.currentRoom?.name ?? v.appointment?.room?.name ?? "—";
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <button onClick={() => setShowClient(true)} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 text-left min-w-0">
              <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-[15px] font-semibold text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2 truncate">{name(v.customer)}</span>
            </button>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-xs text-gray-500">
              {v.appointment?.scheduledAt && <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-gray-400" />{hhmm(v.appointment.scheduledAt)}</span>}
              <span className="inline-flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5 text-gray-400" />{v.appointment?.product?.name ?? "—"}{v.appointment?.durationMinutes ? ` · ${v.appointment.durationMinutes} min` : ""}</span>
              <span className="inline-flex items-center gap-1.5"><DoorOpen className="w-3.5 h-3.5 text-gray-400" />{room}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cyc.cls}`}>{cyc.label}</span>
            <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>
        <div className="p-5">
          <p className="text-xs text-gray-400 mb-3">Trazabilidad — reserva · visita · revisión</p>
          {!apptId ? (
            <p className="text-sm text-gray-400">Sin cita asociada.</p>
          ) : isLoading ? (
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
      </div>
    </div>
    {showClient && <ClientInfoModal customerId={v.customer.id} onClose={() => setShowClient(false)} />}
    </>
  );
}

export default function VisitsPage() {
  return <VisitsBoard />;
}

function VisitsBoard() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus"); // visita a enfocar (llegada desde Reservas)
  const { centers, centerId: ctxCenter } = useAppContext();
  const centerId = ctxCenter || centers[0]?.id || ""; // el tablero necesita un centro concreto
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [traceVisit, setTraceVisit] = useState<Visit | null>(null);
  const [roomWarn, setRoomWarn] = useState<{ visitId: string; roomId: string; roomName: string; bookedName?: string | undefined; occupantName?: string | undefined } | null>(null);
  const [roomFilter, setRoomFilter] = useState("");
  const invalidateBoard = () => qc.invalidateQueries({ queryKey: ["visits-board"] });

  // Abrir la revisión de la visita (creándola si no existe). Al hacerlo, el backend
  // enlaza revisión↔visita; al completarla, la visita se cerrará sola.
  async function openRevision(v: Visit) {
    if (!v.appointment) return;
    setActionErr(null);
    try {
      const res = await apiFetch<{ id: string }>("/revisions", {
        method: "POST",
        body: JSON.stringify({ appointmentId: v.appointment.id }),
      }).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) return err.data as { id: string };
        throw err;
      });
      if (res && typeof res === "object" && "id" in res) router.push(`/revisions/${res.id}`);
    } catch (e) { setActionErr(apptErr(e)); }
  }

  const { data: board, isLoading, isFetching } = useQuery<Board>({
    queryKey: ["visits-board", centerId],
    queryFn: () => apiFetch<Board>(`/visits/board?centerId=${centerId}`),
    enabled: !!centerId,
    refetchInterval: 15_000, // tablero en vivo
  });
  const wt = board?.waitThresholds ?? { amber: 10, red: 20 }; // umbral de espera (config)

  // Enfoque desde Reservas ("Ir a la visita →" / check-in): cuando la tarjeta ya está
  // en el tablero, hace scroll hacia ella, la resalta y limpia el parámetro de la URL.
  useEffect(() => {
    if (!focusId || !board) return;
    const el = document.getElementById(`visit-${focusId}`);
    if (!el) return; // aún no cargada (p.ej. cambiando de centro): reintenta al próximo render
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(focusId);
    router.replace("/visits", { scroll: false });
  }, [focusId, board, router]);

  // El resaltado es temporal (se apaga solo a los pocos segundos).
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 4500);
    return () => clearTimeout(t);
  }, [highlightId]);

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/visits/${v.id}`, { method: "PATCH", body: JSON.stringify(v.body) }),
    onSuccess: () => {
      setActionErr(null);
      qc.invalidateQueries({ queryKey: ["visits-board"] });
    },
    onError: (e) => setActionErr(apptErr(e)),
  });

  const waiting = useMemo(() => (board?.visits ?? []).filter((v) => v.status === "WAITING"), [board]);
  const inRoom = (roomId: string) => (board?.visits ?? []).filter((v) => v.status === "IN_PROGRESS" && v.currentRoom?.id === roomId);
  const completed = useMemo(() => (board?.visits ?? []).filter((v) => v.status === "COMPLETED"), [board]);

  const allRooms = board?.rooms ?? [];
  // Si la sala elegida ya no está en el tablero (cambio de centro), se resetea.
  useEffect(() => {
    if (roomFilter && !allRooms.some((r) => r.id === roomFilter)) setRoomFilter("");
  }, [allRooms, roomFilter]);
  // El filtro solo acota las columnas de sala (y a dónde se puede "llamar"); la
  // sala de espera y los KPIs siguen siendo del centro completo.
  const shownRooms = roomFilter ? allRooms.filter((r) => r.id === roomFilter) : allRooms;
  const roomCenters = board ? [{ id: board.center.id, name: board.center.name, rooms: allRooms }] : [];
  // Ocupación de salas: primera visita "en sala" por sala (para avisar/indicar).
  const roomOccupant = new Map<string, VisitCustomer>();
  for (const vv of board?.visits ?? []) {
    if (vv.status === "IN_PROGRESS" && vv.currentRoom?.id && !roomOccupant.has(vv.currentRoom.id)) roomOccupant.set(vv.currentRoom.id, vv.customer);
  }

  const dateLabel = board ? new Date(`${board.date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <div className="p-6 max-w-5xl">
      {/* Fila superior: título + pestañas (izq) · estado en vivo + acción (der) */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-semibold text-gray-900">Visitas</h1>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            <button className="px-3 py-1.5 text-sm rounded-md font-medium bg-white shadow-sm text-gray-900">Gestión</button>
            <button onClick={() => router.push("/visits/utilizacion")} className="px-3 py-1.5 text-sm rounded-md font-medium text-gray-500 hover:text-gray-700">Utilización</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full" title="El tablero se actualiza solo">
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 ${isFetching ? "animate-ping" : ""}`} />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            En directo
          </span>
          <a href="/monitor" target="_blank" rel="noopener" className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2">Abrir monitor</a>
          {centerId && (
            <button
              onClick={() => setShowWalkIn(true)}
              className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Nueva visita
            </button>
          )}
        </div>
      </div>

      {/* Fila de controles: fecha (izq) · sala (der, misma posición que Reservas) */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <p className="text-sm text-gray-500 capitalize">{dateLabel || "Actividad del día"}</p>
        {allRooms.length > 0 && (
          <div className="ml-auto"><RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={setRoomFilter} /></div>
        )}
      </div>

      {showWalkIn && centerId && (
        <WalkInModal
          centerId={centerId}
          onClose={() => setShowWalkIn(false)}
          onDone={() => { setShowWalkIn(false); invalidateBoard(); }}
        />
      )}
      {traceVisit && <VisitTraceModal v={traceVisit} onClose={() => setTraceVisit(null)} />}
      {roomWarn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRoomWarn(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2 text-amber-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
              <h2 className="text-base font-semibold text-gray-900">
                {roomWarn.occupantName && roomWarn.bookedName ? "Sala ocupada y distinta a la reservada" : roomWarn.occupantName ? "Sala ocupada" : "Sala distinta a la reservada"}
              </h2>
            </div>
            <div className="text-sm text-gray-600 mb-4 space-y-1">
              {roomWarn.occupantName && <p><span className="font-medium text-gray-900">{roomWarn.roomName}</span> ya tiene a <span className="font-medium text-gray-900">{roomWarn.occupantName}</span> en curso.</p>}
              {roomWarn.bookedName && <p>Esta cita reservó <span className="font-medium text-gray-900">{roomWarn.bookedName}</span>.</p>}
              <p>¿Enviar el paciente a <span className="font-medium text-gray-900">{roomWarn.roomName}</span> de todas formas?</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRoomWarn(null)} className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={() => { patch.mutate({ id: roomWarn.visitId, body: { status: "IN_PROGRESS", currentRoomId: roomWarn.roomId } }); setRoomWarn(null); }} className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">Enviar a {roomWarn.roomName}</button>
            </div>
          </div>
        </div>
      )}

      {actionErr && <p className="text-sm text-red-600 mb-3">{actionErr}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi icon={Hourglass} label="En espera" value={board?.kpis.waiting ?? 0} bg="bg-amber-50 border-amber-100" color="text-amber-700" labelColor="text-amber-700" />
        <Kpi icon={DoorOpen} label="En sala" value={board?.kpis.inProgress ?? 0} bg="bg-blue-50 border-blue-100" color="text-blue-700" labelColor="text-blue-700" />
        <Kpi icon={CheckCircle2} label="Finalizadas hoy" value={board?.kpis.completedToday ?? 0} bg="bg-emerald-50 border-emerald-100" color="text-emerald-700" labelColor="text-emerald-700" />
        <Kpi icon={Clock} label="Espera media" value={`${board?.kpis.avgWaitMinutes ?? 0} min`} />
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Cargando tablero…</p>
      ) : !board ? (
        <p className="text-sm text-gray-400">Selecciona un centro.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {/* Sala de espera */}
          <Column title="Sala de espera" icon="chair" count={waiting.length}>
            {waiting.length === 0 && <Empty>Nadie esperando</Empty>}
            {waiting.map((v) => {
              const mins = minsSince(v.arrivedAt);
              return (
                <VisitCard key={v.id} v={v} highlighted={highlightId === v.id} onOpen={() => setTraceVisit(v)}>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${waitPillClass(mins, wt)}`}>esperando {mins} min</span>
                  <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <select
                      defaultValue=""
                      disabled={patch.isPending}
                      onChange={(e) => {
                        const roomId = e.target.value;
                        if (!roomId) return;
                        const bookedId = v.appointment?.room?.id;
                        const differs = !!bookedId && roomId !== bookedId;
                        const occupant = roomOccupant.get(roomId);
                        if (differs || occupant) {
                          const roomName = shownRooms.find((r) => r.id === roomId)?.name ?? "esa sala";
                          setRoomWarn({
                            visitId: v.id, roomId, roomName,
                            bookedName: differs ? (v.appointment?.room?.name ?? "otra sala") : undefined,
                            occupantName: occupant ? name(occupant) : undefined,
                          });
                          e.target.value = "";
                        } else {
                          patch.mutate({ id: v.id, body: { status: "IN_PROGRESS", currentRoomId: roomId } });
                        }
                      }}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">Llamar a sala…</option>
                      {shownRooms.map((r) => <option key={r.id} value={r.id}>{r.name}{roomOccupant.has(r.id) ? " · ocupada" : ""}</option>)}
                    </select>
                    <button
                      disabled={patch.isPending}
                      onClick={() => patch.mutate({ id: v.id, body: { status: "LEFT" } })}
                      title="Se fue sin ser atendido"
                      className="flex-shrink-0 w-9 h-9 rounded-full border border-red-300 text-red-600 hover:bg-red-50 text-[9px] font-medium leading-tight flex items-center justify-center text-center disabled:opacity-50"
                    >
                      Se fue
                    </button>
                  </div>
                </VisitCard>
              );
            })}
          </Column>

          {/* Una columna por sala (acotada por el filtro) */}
          {shownRooms.map((r) => {
            const occ = inRoom(r.id);
            return (
              <Column key={r.id} title={r.name} icon="door" count={occ.length}>
                {occ.length === 0 && <Empty>Libre</Empty>}
                {occ.map((v) => {
                  const mins = minsSince(v.startedAt ?? v.calledAt);
                  return (
                    <VisitCard key={v.id} v={v} highlighted={highlightId === v.id} onOpen={() => setTraceVisit(v)}>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">en sala · {mins} min</span>
                      {v.appointment?.room && v.currentRoom && v.currentRoom.id !== v.appointment.room.id && (
                        <span title={`Reservó ${v.appointment.room.name}`} className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                          reservó {v.appointment.room.name}
                        </span>
                      )}
                      <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {v.appointment ? (
                          <button
                            disabled={patch.isPending}
                            onClick={() => openRevision(v)}
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium inline-flex items-center justify-center gap-1.5"
                          >
                            <Stethoscope className="w-3.5 h-3.5" />{v.revision ? "Continuar revisión" : "Abrir revisión"}
                          </button>
                        ) : (
                          <button
                            disabled={patch.isPending}
                            onClick={() => patch.mutate({ id: v.id, body: { status: "COMPLETED" } })}
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 font-medium inline-flex items-center justify-center gap-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />Finalizar
                          </button>
                        )}
                        <button
                          disabled={patch.isPending}
                          onClick={() => patch.mutate({ id: v.id, body: { status: "WAITING", currentRoomId: null } })}
                          className="shrink-0 w-7 h-7 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50 flex items-center justify-center disabled:opacity-50"
                          title="Devolver a la sala de espera"
                          aria-label="Devolver a la sala de espera"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </VisitCard>
                  );
                })}
              </Column>
            );
          })}
        </div>
      )}

      {/* Finalizadas hoy (tira inferior colapsada) */}
      {completed.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Finalizadas hoy · {completed.length}</p>
          <div className="flex flex-wrap gap-2">
            {completed.map((v) => (
              <span key={v.id} id={`visit-${v.id}`} className={`text-xs border rounded-lg px-2.5 py-1 text-gray-600 inline-flex items-center gap-1.5 transition-all ${highlightId === v.id ? "border-blue-400 ring-2 ring-blue-300 bg-blue-50/50" : "bg-gray-50 border-gray-200"}`}>
                {name(v.customer)}
                {v.revision?.outcome === "APTO" && <span className="text-green-600">· apto</span>}
                {v.revision?.outcome === "NO_APTO" && <span className="text-red-600">· no apto</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Leyenda */}
      <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <Legend color="bg-emerald-500" label={`espera <${wt.amber} min`} />
        <Legend color="bg-amber-500" label={`${wt.amber}–${wt.red} min`} />
        <Legend color="bg-red-500" label={`>${wt.red} min`} />
        <Legend color="bg-blue-500" label="en sala" />
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, bg = "bg-white border-gray-200", color = "text-gray-900", labelColor = "text-gray-500" }: {
  icon: typeof Clock; label: string; value: string | number; bg?: string; color?: string; labelColor?: string;
}) {
  return (
    <div className={`border rounded-xl px-4 py-3 ${bg}`}>
      <p className={`text-xs flex items-center gap-1.5 ${labelColor}`}><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function Column({ title, count, icon, children }: { title: string; count: number; icon: "chair" | "door"; children: React.ReactNode }) {
  const Icon = icon === "chair" ? Armchair : DoorOpen;
  // Contador tintado según el significado de la columna (espera ámbar; sala azul si ocupada).
  const badge = icon === "chair" ? "text-amber-700 bg-amber-50" : count > 0 ? "text-blue-700 bg-blue-50" : "text-gray-400 bg-white border border-gray-200";
  return (
    <div className="bg-gray-50 rounded-xl p-2.5 min-w-[240px] w-[240px] flex-shrink-0 flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 truncate"><Icon className="w-4 h-4 text-gray-400 shrink-0" />{title}</span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge}`}>{count}</span>
      </div>
      {children}
    </div>
  );
}

// Avatar tintado de forma estable por cliente (mismo color siempre para la misma persona).
const AV_TINT = ["bg-blue-50 text-blue-700", "bg-violet-50 text-violet-700", "bg-emerald-50 text-emerald-700", "bg-amber-50 text-amber-700", "bg-pink-50 text-pink-700"];
const avTint = (id: string) => AV_TINT[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_TINT.length];

function VisitCard({ v, onOpen, highlighted, children }: { v: Visit; onOpen?: () => void; highlighted?: boolean; children: React.ReactNode }) {
  const roomLabel = v.currentRoom?.name ?? v.appointment?.room?.name ?? "Sala de espera";
  const statusInfo = v.status === "WAITING" ? `esperando ${minsSince(v.arrivedAt)} min` : v.status === "IN_PROGRESS" ? `en sala ${minsSince(v.startedAt ?? v.calledAt)} min` : v.status.toLowerCase();
  const dur = v.appointment?.durationMinutes ? ` · ${v.appointment.durationMinutes} min` : "";
  const tip = `${name(v.customer)} · ${v.appointment?.product?.name ?? "Sin producto"}${dur}\n${roomLabel} · llegó ${new Date(v.arrivedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}\n${statusInfo}`;
  // Barra de acento azul para "en sala" (refuerza el en directo); el resaltado por ?focus manda.
  const accent = v.status === "IN_PROGRESS" && !highlighted;
  return (
    <div id={`visit-${v.id}`} title={tip} onClick={onOpen}
      style={accent ? { boxShadow: "inset 3px 0 0 #3b82f6" } : undefined}
      className={`bg-white border rounded-lg p-2.5 flex gap-2 transition-all ${highlighted ? "border-blue-400 ring-2 ring-blue-300 ring-offset-1" : accent ? "border-blue-200" : "border-gray-200"} ${onOpen ? "cursor-pointer hover:border-blue-300 transition-colors" : ""}`}>
      <div className={`w-7 h-7 rounded-full text-[11px] font-medium flex items-center justify-center flex-shrink-0 ${avTint(v.customer.id)}`}>
        {initials(v.customer)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{name(v.customer)}</p>
        <p className="text-xs text-gray-500 truncate">{v.appointment?.product?.name ?? "Sin producto"}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-gray-200 rounded-lg py-4 text-center text-xs text-gray-300">{children}</div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${color}`} />{label}</span>;
}
