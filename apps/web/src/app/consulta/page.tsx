"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, authHeaders } from "@/lib/api";
import { useAppContext } from "@/components/context-bar";
import { CheckCircle2, XCircle, FileText } from "lucide-react";

type State = "upcoming" | "ready" | "in_progress" | "done";
interface Cust { id: string; firstName: string | null; lastName: string | null }
interface CItem {
  id: string;
  scheduledAt: string;
  status: string;
  customer: Cust;
  product: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  visit: { id: string; status: string; arrivedAt: string; currentRoom: { id: string; name: string } | null } | null;
  revision: { id: string; outcome: string } | null;
  state: State;
  mine: boolean;
}
interface CData { center: { id: string; name: string }; date: string; rooms: { id: string; name: string }[]; myRoomIds: string[]; items: CItem[] }

const name = (c: Cust) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
const initials = (c: Cust) => ((c.firstName?.[0] ?? "") + (c.lastName?.[0] ?? "")).toUpperCase() || "?";
const hhmm = (iso: string) => iso.slice(11, 16);
const minsSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

function apptErr(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Array.isArray(e.errors) ? (e.errors[0] as { message?: string; code?: string }) : undefined;
    return first?.message ?? first?.code ?? `Error ${e.status}`;
  }
  return "Error inesperado";
}

export default function ConsultaPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { centers, centerId: ctxCenter } = useAppContext();
  const centerId = ctxCenter || centers[0]?.id || "";
  const searchParams = useSearchParams();
  // La pestaña vive en la URL (?scope=all) para que al volver desde la revisión
  // (router.back) se conserve en vez de reiniciarse a "Míos".
  const [scope, setScope] = useState<"mine" | "all">(searchParams.get("scope") === "all" ? "all" : "mine");
  function changeScope(s: "mine" | "all") {
    setScope(s);
    router.replace(s === "all" ? "/consulta?scope=all" : "/consulta");
  }
  const [err, setErr] = useState<string | null>(null);

  const { data, isFetching } = useQuery<CData>({
    queryKey: ["consulta", centerId],
    queryFn: () => apiFetch<CData>(`/visits/consulta?centerId=${centerId}`),
    enabled: !!centerId,
    refetchInterval: 20_000,
  });

  const hasMyRooms = (data?.myRoomIds.length ?? 0) > 0;
  const effectiveScope = hasMyRooms ? scope : "all";
  const items = useMemo(() => (data?.items ?? []).filter((i) => effectiveScope === "all" || i.mine), [data, effectiveScope]);

  // "Listo para atender": llegados sin revisión. En sala primero, luego en espera.
  const ready = items.filter((i) => i.state === "ready").sort((a, b) => {
    const rank = (i: CItem) => (i.visit?.status === "IN_PROGRESS" ? 0 : 1);
    return rank(a) - rank(b) || a.scheduledAt.localeCompare(b.scheduledAt);
  });
  const inCurso = items.filter((i) => i.state === "in_progress");
  const upcoming = items.filter((i) => i.state === "upcoming");
  const done = items.filter((i) => i.state === "done");

  // Abrir (o crear) la revisión de una cita y navegar a ella.
  const atender = useMutation({
    mutationFn: async (appointmentId: string) => {
      const res = await apiFetch<{ id: string }>("/revisions", { method: "POST", body: JSON.stringify({ appointmentId }) })
        .catch((e: unknown) => { if (e instanceof ApiError && e.status === 409) return e.data as { id: string }; throw e; });
      return res.id;
    },
    onSuccess: (id) => { setErr(null); qc.invalidateQueries({ queryKey: ["consulta"] }); router.push(`/revisions/${id}`); },
    onError: (e) => setErr(apptErr(e)),
  });

  async function verCertificado(revisionId: string) {
    const res = await fetch(`/api/proxy/revisions/${revisionId}/pdf`, { headers: authHeaders() });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const dateLabel = data ? new Date(`${data.date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <div className="p-6 max-w-5xl">
      {/* Cabecera: título + fecha · KPIs · alcance */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Consulta</h1>
          <p className="text-sm text-gray-500 capitalize">{dateLabel || "Tu jornada"}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Kpi value={ready.length + upcoming.length} label="pendientes" color="text-gray-800" />
          <Kpi value={inCurso.length} label="en curso" color="text-blue-700" />
          <Kpi value={done.length} label="hechas hoy" color="text-emerald-700" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {hasMyRooms ? (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {([["mine", "Míos"], ["all", "Todo el centro"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => changeScope(k)}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${scope === k ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>{l}</button>
            ))}
          </div>
        ) : <span />}
        <span className="text-xs text-gray-400 inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isFetching ? "bg-emerald-400 animate-pulse" : "bg-gray-300"}`} />
          se actualiza solo
        </span>
      </div>

      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}

      {!data ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <p className="text-sm text-gray-500">No tienes pacientes {effectiveScope === "mine" ? "asignados " : ""}para hoy.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Listo para atender */}
          <Section title="Listo para atender" hint="pacientes presentes, esperándote" count={ready.length}>
            {ready.length === 0 ? <Empty>Nadie esperando ahora mismo.</Empty> : ready.map((i) => (
              <Card key={i.id} item={i}>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag item={i} />
                  <button onClick={() => atender.mutate(i.id)} disabled={atender.isPending}
                    className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                    <Stethoscope /> Atender
                  </button>
                </div>
              </Card>
            ))}
          </Section>

          {/* En curso */}
          {inCurso.length > 0 && (
            <Section title="En curso" hint="revisión empezada, sin cerrar" count={inCurso.length}>
              {inCurso.map((i) => (
                <Card key={i.id} item={i} accent>
                  <button onClick={() => i.revision && router.push(`/revisions/${i.revision.id}`)}
                    className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 inline-flex items-center gap-1.5 shrink-0">
                    Continuar →
                  </button>
                </Card>
              ))}
            </Section>
          )}

          {/* Próximos hoy */}
          {upcoming.length > 0 && (
            <Section title="Próximos hoy" hint="reservados, aún no en sala" count={upcoming.length}>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                {upcoming.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm font-mono tabular-nums text-gray-500 w-12">{hhmm(i.scheduledAt)}</span>
                    <span className="text-sm text-gray-900 flex-1 truncate">{name(i.customer)}</span>
                    <span className="text-xs text-gray-500 truncate hidden sm:block">{i.product?.name ?? "—"}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{i.room?.name ?? "sin sala"}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Hechas hoy */}
          {done.length > 0 && (
            <Section title="Hechas hoy" count={done.length}>
              <div className="flex flex-wrap gap-2">
                {done.map((i) => {
                  const apto = i.revision?.outcome === "APTO";
                  const noApto = i.revision?.outcome === "NO_APTO";
                  return (
                    <span key={i.id} className="text-sm bg-white border border-gray-200 rounded-xl pl-2 pr-3 py-1.5 inline-flex items-center justify-between gap-4 min-w-[280px]">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${apto ? "bg-emerald-50" : noApto ? "bg-red-50" : "bg-gray-100"}`}>
                          {apto ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : noApto ? <XCircle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4 text-gray-400" />}
                        </span>
                        <span className="font-medium text-gray-800 truncate">{name(i.customer)}</span>
                      </span>
                      <span className="inline-flex items-center gap-2.5 shrink-0">
                        {apto && <span className="text-xs text-emerald-600 font-medium">Apto</span>}
                        {noApto && <span className="text-xs text-red-600 font-medium">No apto</span>}
                        {apto && (
                          <button onClick={() => i.revision && verCertificado(i.revision.id)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                            <FileText className="w-3.5 h-3.5" /> certificado
                          </button>
                        )}
                      </span>
                    </span>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3.5 py-1.5 text-center min-w-[62px]">
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Section({ title, hint, count, children }: { title: string; hint?: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-sm font-medium text-gray-800">{title}</span>
        <span className="text-xs text-gray-400">· {count}</span>
        {hint && <span className="text-xs text-gray-400 hidden sm:inline">· {hint}</span>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Card({ item, children, accent }: { item: CItem; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-3.5 flex items-center gap-3.5 ${accent ? "border-blue-200" : "border-gray-200"}`}>
      <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-700 text-sm font-medium flex items-center justify-center shrink-0">{initials(item.customer)}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{name(item.customer)}</p>
        <p className="text-xs text-gray-500 truncate">
          {item.product?.name ?? "Sin producto"}
          {item.state === "in_progress" && item.visit?.currentRoom ? ` · ${item.visit.currentRoom.name}` : item.room ? ` · ${item.room.name}` : ""}
        </p>
      </div>
      {children}
    </div>
  );
}

function StatusTag({ item }: { item: CItem }) {
  if (item.visit?.status === "IN_PROGRESS") {
    const mins = minsSince(item.visit.arrivedAt);
    const cls = mins > 20 ? "text-red-600" : mins >= 10 ? "text-amber-600" : "text-emerald-600";
    return <span className={`text-xs ${cls} hidden sm:inline`}>en sala · {mins} min</span>;
  }
  return <span className="text-xs text-gray-400 hidden sm:inline">en espera · {hhmm(item.scheduledAt)}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 py-2">{children}</p>;
}
function Stethoscope() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3v5a6 6 0 0 0 12 0V3M8 3H4m4 0h0M16 3h4m-4 0h0"/><circle cx="20" cy="14" r="2"/><path d="M10 14v2a6 6 0 0 0 8 4"/></svg>;
}
