"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Monitor de sala ("pantalla") — vista de SOLO LECTURA para colgar en un TV/monitor
// en el centro. Reutiliza GET /visits/board (sin endpoints ni backend nuevos) y la
// sesión existente (kiosk: el personal inicia sesión una vez en el dispositivo).
//
// No lleva AppLayout: al vivir en /monitor SIN un layout.tsx que lo envuelva, se
// renderiza a pantalla completa sin sidebar ni barra de contexto. La autenticación
// se sigue exigiendo con el mismo useAuth (redirige a /login si no hay sesión).
//
// PRIVACIDAD (RGPD): la sala de espera es un espacio público, así que por defecto
// NO mostramos el apellido completo del paciente, solo su inicial ("María G.").
// Cambia esta constante a `true` solo si el despliegue lo permite legalmente.
const SHOW_FULL_NAMES = false;
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
  appointment: { id: string; scheduledAt: string; status: string; product: { id: string; name: string } | null; room: Room | null } | null;
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

// Clave propia del monitor: NO reutilizamos la del contexto global (ctx_center1)
// para que elegir centro aquí no afecte al resto de la app, ni viceversa.
const MONITOR_CENTER_KEY = "monitor_center";

// Nombre respetuoso con la privacidad: nombre + inicial del apellido.
const displayName = (c: VisitCustomer) => {
  const first = (c.firstName ?? "").trim();
  const last = (c.lastName ?? "").trim();
  if (SHOW_FULL_NAMES) return `${first} ${last}`.trim() || "Sin nombre";
  if (!first && !last) return "Sin nombre";
  const lastInitial = last ? `${last[0]!.toUpperCase()}.` : "";
  return `${first} ${lastInitial}`.trim();
};
const initials = (c: VisitCustomer) => ((c.firstName?.[0] ?? "") + (c.lastName?.[0] ?? "")).toUpperCase() || "?";
const minsSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)) : 0);

// Semáforo de espera (fondo oscuro): verde por debajo del ámbar, ámbar hasta el rojo.
function waitPillClass(mins: number, t: { amber: number; red: number }) {
  if (mins > t.red) return "bg-red-500/20 text-red-300 ring-1 ring-red-500/40";
  if (mins >= t.amber) return "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40";
  return "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40";
}
function waitDotClass(mins: number, t: { amber: number; red: number }) {
  if (mins > t.red) return "bg-red-400";
  if (mins >= t.amber) return "bg-amber-400";
  return "bg-emerald-400";
}

export default function MonitorPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Mismo patrón de guardia que AppLayout: exige sesión, redirige a /login.
  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-400" />
      </div>
    );
  }
  if (!user) return null;

  return <Monitor />;
}

function Monitor() {
  // Centro elegido para este dispositivo, recordado en localStorage.
  const [centerId, setCenterIdState] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(MONITOR_CENTER_KEY) ?? "" : "",
  );
  const setCenterId = (id: string) => {
    setCenterIdState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(MONITOR_CENTER_KEY, id);
      else localStorage.removeItem(MONITOR_CENTER_KEY);
    }
  };

  // Reloj: se actualiza cada segundo (convención local, sin librerías).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);

  // Centros del tenant (misma fuente que el resto de la app, sin barra de contexto).
  const { data: centers, isLoading: centersLoading } = useQuery<Center[]>({
    queryKey: ["monitor-centers"],
    queryFn: () => apiFetch<Center[]>("/centers"),
    staleTime: 5 * 60_000,
  });

  // Si el centro guardado ya no existe, se limpia para no apuntar a uno ajeno.
  useEffect(() => {
    if (centerId && centers && !centers.some((c) => c.id === centerId)) setCenterId("");
  }, [centers, centerId]);

  // Si solo hay un centro, se usa directamente (sin obligar a elegir).
  const effectiveCenter = centerId || (centers && centers.length === 1 ? centers[0]!.id : "");

  const { data: board, isLoading: boardLoading, isFetching, isError } = useQuery<Board>({
    queryKey: ["monitor-board", effectiveCenter],
    queryFn: () => apiFetch<Board>(`/visits/board?centerId=${effectiveCenter}`),
    enabled: !!effectiveCenter,
    refetchInterval: 15_000, // espejo en vivo
  });
  const wt = board?.waitThresholds ?? { amber: 10, red: 20 }; // umbral de espera (config)

  const waiting = useMemo(() => (board?.visits ?? []).filter((v) => v.status === "WAITING"), [board]);
  const inRoom = (roomId: string) => (board?.visits ?? []).filter((v) => v.status === "IN_PROGRESS" && v.currentRoom?.id === roomId);

  const timeLabel = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const dateLabel = now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

  // ── Elección de centro (solo si hay varios y aún no se ha elegido) ──────────
  if (!effectiveCenter) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="w-full max-w-lg text-center">
          <h1 className="text-3xl font-semibold mb-2">Monitor de sala</h1>
          <p className="text-slate-400 mb-8 text-lg">Selecciona el centro que mostrará esta pantalla.</p>
          {centersLoading ? (
            <p className="text-slate-500 text-xl">Cargando centros…</p>
          ) : !centers || centers.length === 0 ? (
            <p className="text-slate-500 text-xl">No hay centros disponibles.</p>
          ) : (
            <div className="grid gap-3">
              {centers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCenterId(c.id)}
                  className="w-full px-5 py-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xl font-medium transition-colors"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const centerName = board?.center.name ?? centers?.find((c) => c.id === effectiveCenter)?.name ?? "";
  const canChangeCenter = (centers?.length ?? 0) > 1;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {/* Cabecera: centro + en directo (izq) · reloj y fecha (der) */}
      <header className="flex items-center justify-between gap-4 px-8 pt-6 pb-4">
        <div className="flex items-center gap-5 min-w-0">
          <h1 className="text-3xl font-semibold truncate">{centerName || "Monitor de sala"}</h1>
          <span className="inline-flex items-center gap-2 text-sm text-slate-400 whitespace-nowrap">
            <span className={`w-2.5 h-2.5 rounded-full ${isFetching ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            en directo
          </span>
          {canChangeCenter && (
            <button
              onClick={() => setCenterId("")}
              className="text-sm text-slate-500 hover:text-slate-300 underline underline-offset-4 whitespace-nowrap"
            >
              cambiar centro
            </button>
          )}
        </div>
        <div className="text-right">
          <div className="text-5xl font-bold tabular-nums leading-none">{timeLabel}</div>
          <div className="text-base text-slate-400 capitalize mt-1">{dateLabel}</div>
        </div>
      </header>

      {/* KPIs grandes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-8 pb-4">
        <Kpi label="En espera" value={board?.kpis.waiting ?? 0} accent="text-amber-300" />
        <Kpi label="En sala" value={board?.kpis.inProgress ?? 0} accent="text-sky-300" />
        <Kpi label="Finalizadas hoy" value={board?.kpis.completedToday ?? 0} accent="text-emerald-300" />
        <Kpi label="Espera media" value={`${board?.kpis.avgWaitMinutes ?? 0} min`} accent="text-slate-100" />
      </div>

      {/* Cuerpo: columnas por sala + sala de espera */}
      <main className="flex-1 px-8 pb-6 min-h-0">
        {boardLoading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-3xl text-slate-500">Cargando actividad…</p>
          </div>
        ) : isError || !board ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-3xl text-slate-500">No se pudo cargar la actividad.</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto h-full pb-2">
            {/* Sala de espera */}
            <Column title="Sala de espera" count={waiting.length} tone="amber">
              {waiting.length === 0 ? (
                <Empty>Nadie esperando</Empty>
              ) : (
                waiting.map((v) => {
                  const mins = minsSince(v.arrivedAt);
                  return (
                    <VisitCard key={v.id} v={v}>
                      <span className={`text-base px-3 py-1 rounded-full inline-flex items-center gap-2 ${waitPillClass(mins, wt)}`}>
                        <span className={`w-2 h-2 rounded-full ${waitDotClass(mins, wt)}`} />
                        {mins} min
                      </span>
                    </VisitCard>
                  );
                })
              )}
            </Column>

            {/* Una columna por sala */}
            {(board.rooms ?? []).map((r) => {
              const occ = inRoom(r.id);
              return (
                <Column key={r.id} title={r.name} count={occ.length} tone="sky">
                  {occ.length === 0 ? (
                    <Empty>Libre</Empty>
                  ) : (
                    occ.map((v) => {
                      const mins = minsSince(v.startedAt ?? v.calledAt);
                      return (
                        <VisitCard key={v.id} v={v}>
                          <span className="text-base px-3 py-1 rounded-full bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40">
                            en sala · {mins} min
                          </span>
                        </VisitCard>
                      );
                    })
                  )}
                </Column>
              );
            })}
          </div>
        )}
      </main>

      {/* Leyenda del semáforo */}
      <footer className="px-8 pb-6 flex flex-wrap items-center gap-6 text-sm text-slate-400">
        <Legend color="bg-emerald-400" label={`espera <${wt.amber} min`} />
        <Legend color="bg-amber-400" label={`${wt.amber}–${wt.red} min`} />
        <Legend color="bg-red-400" label={`>${wt.red} min`} />
        <Legend color="bg-sky-400" label="en sala" />
      </footer>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-slate-900 rounded-2xl px-6 py-5 ring-1 ring-slate-800">
      <p className="text-base text-slate-400">{label}</p>
      <p className={`text-5xl font-bold mt-1 tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function Column({ title, count, tone, children }: { title: string; count: number; tone: "amber" | "sky"; children: React.ReactNode }) {
  const countClass = tone === "amber" ? "bg-amber-500/20 text-amber-300" : "bg-sky-500/20 text-sky-300";
  return (
    <div className="bg-slate-900/60 rounded-2xl p-4 min-w-[320px] w-[320px] flex-shrink-0 flex flex-col gap-3 ring-1 ring-slate-800">
      <div className="flex items-center justify-between px-1">
        <span className="text-xl font-semibold text-slate-200 truncate">{title}</span>
        <span className={`text-lg font-bold px-3 py-0.5 rounded-full tabular-nums ${countClass}`}>{count}</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto">{children}</div>
    </div>
  );
}

function VisitCard({ v, children }: { v: Visit; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 flex gap-3 items-center">
      <div className="w-12 h-12 rounded-full bg-slate-700 text-slate-200 text-lg font-semibold flex items-center justify-center flex-shrink-0">
        {initials(v.customer)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-semibold text-white truncate">{displayName(v.customer)}</p>
        <p className="text-base text-slate-400 truncate mb-2">{v.appointment?.product?.name ?? "Sin producto"}</p>
        <div>{children}</div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-lg text-slate-600 text-center py-6">{children}</p>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${color}`} />{label}</span>;
}
