"use client";

// Módulo de visualización de la analítica (capacidad crm-dashboards). Consume SOLO
// la API /analytics/* (sin lógica de métrica en cliente). Filtros persistidos en la
// URL; resumen orientado a decisión (KPIs + alertas + comparación de periodo);
// vistas de embudo, ocupación/saturación, médicos, comparativa y volumen; export CSV.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Percent, DoorOpen, Gauge, UserX, Download, AlertTriangle, ChevronRight, Stethoscope,
} from "lucide-react";

// ── Tipos que devuelve la API ────────────────────────────────────────────────
interface Funnel {
  reservas: number; confirmadas: number; atendidas: number; visitasCompletadas: number;
  fugas: { canceladasCliente: number; canceladasCentro: number; canceladasOtras: number; reprogramadas: number; noShow: number; seFue: number };
  ruido: number; tasas: { confirmacion: number; atencion: number; noShow: number; cancelacion: number };
}
interface OccRow { roomId: string; roomName: string; centerId: string; centerName: string; disponibles: number; usados: number; ocupacion: number }
interface Occupancy { salas: OccRow[]; total: { disponibles: number; usados: number; ocupacion: number } }
interface SatBucket { bucket: string; demanda: number; capacidad: number; saturacion: number; saturado: boolean }
interface DoctorRow { doctorId: string; doctorName: string; visitasAtendidas: number; pacientesDistintos: number; apto: number; noApto: number; tasaAptitud: number | null; tiempoMedioMin: number | null }
interface CompRow { id: string; name: string; centerName?: string; reservas: number; atendidas: number; conversion: number; ocupacion: number }
interface Comparison { porCentro: CompRow[]; porSala: CompRow[] }
interface VolBucket { bucket: string; reservas: number; visitas: number }

interface Filters { from: string; to: string; centerId: string; roomId: string; doctorId: string; productId: string; scope: string }

// Listados para los desplegables de filtro.
interface CenterOpt { id: string; name: string; rooms?: { id: string; name: string }[] }
interface DoctorOpt { id: string; firstName?: string | null; lastName?: string | null }
interface ProductOpt { id: string; name: string }

// ── Utilidades ───────────────────────────────────────────────────────────────
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function addDays(s: string, n: number): string { return ymd(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000)); }
function daysBetween(a: string, b: string): number { return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1; }

// Periodo anterior de igual longitud (para la comparación).
function prevPeriod(f: Filters): { from: string; to: string } {
  const len = daysBetween(f.from, f.to);
  const to = addDays(f.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

function buildQs(f: Filters, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  p.set("from", f.from); p.set("to", f.to);
  if (f.scope === "all") p.set("scope", "all");
  else {
    if (f.centerId) p.set("centerId", f.centerId);
    if (f.roomId) p.set("roomId", f.roomId);
  }
  if (f.doctorId) p.set("doctorId", f.doctorId);
  if (f.productId) p.set("productId", f.productId);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  return p.toString();
}

async function exportCsv(ep: string, f: Filters, extra?: Record<string, string>) {
  const res = await fetch(`/api/proxy/analytics/${ep}?${buildQs(f, { ...extra, format: "csv" })}`, { headers: authHeaders() });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${ep}_${f.from}_${f.to}.csv`; a.click();
  URL.revokeObjectURL(url);
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function bucketLabel(b: string): string {
  const m = b.match(/^(\d{4})-(\d{2})$/); // mes
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]!.slice(2)}`;
  if (/^\d{4}$/.test(b)) return b; // año
  const d = b.match(/^(\d{4})-(\d{2})-(\d{2})$/); // día/semana
  if (d) return `${d[3]}/${d[2]}`;
  return b;
}

// ── Componentes de presentación ──────────────────────────────────────────────
const TONE: Record<string, string> = {
  plain: "bg-white border-gray-200 text-gray-800",
  accent: "bg-blue-50 border-blue-100 text-blue-700",
  warning: "bg-amber-50 border-amber-100 text-amber-700",
  success: "bg-emerald-50 border-emerald-100 text-emerald-700",
  danger: "bg-red-50 border-red-100 text-red-700",
};

function Kpi({ icon: Icon, label, value, delta, goodWhenUp, tone = "plain", suffix }: {
  icon: typeof Percent; label: string; value: string | number; delta?: number | null;
  goodWhenUp?: boolean; tone?: keyof typeof TONE; suffix?: string;
}) {
  const showDelta = delta != null && Number.isFinite(delta) && Math.abs(delta) >= 0.05;
  const up = (delta ?? 0) > 0;
  const good = goodWhenUp ? up : !up;
  return (
    <div className={`rounded-xl border px-4 py-3 ${TONE[tone]}`}>
      <p className={`text-xs font-medium mb-0.5 flex items-center gap-1.5 ${tone === "plain" ? "text-gray-500" : ""}`}>
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="text-2xl font-bold">{value}{suffix}</p>
      {showDelta && (
        <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${good ? "text-emerald-600" : "text-red-600"}`}>
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {up ? "+" : ""}{Math.round(delta! * 10) / 10}{suffix} vs periodo anterior
        </p>
      )}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function CsvButton({ ep, f, extra }: { ep: string; f: Filters; extra?: Record<string, string> }) {
  return (
    <button onClick={() => exportCsv(ep, f, extra)}
      className="text-xs inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1 text-gray-600 hover:bg-gray-50 transition-colors">
      <Download className="w-3.5 h-3.5" /> CSV
    </button>
  );
}

const empty = <p className="text-center text-gray-400 text-sm py-8">Sin datos en el periodo</p>;

// ── Página ───────────────────────────────────────────────────────────────────
const VIEWS = [
  { id: "resumen", label: "Resumen" },
  { id: "embudo", label: "Embudo" },
  { id: "ocupacion", label: "Ocupación" },
  { id: "saturacion", label: "Saturación" },
  { id: "medicos", label: "Médicos" },
  { id: "comparativa", label: "Comparativa" },
  { id: "volumen", label: "Volumen" },
];

export default function AnaliticaPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">Cargando…</div>}>
      <AnaliticaInner />
    </Suspense>
  );
}

function AnaliticaInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();
  const isSuper = user?.role === "SUPERADMIN";

  const today = ymd(new Date());
  const [from, setFrom] = useState(sp.get("from") ?? addDays(today, -89));
  const [to, setTo] = useState(sp.get("to") ?? today);
  const [centerId, setCenterId] = useState(sp.get("centerId") ?? "");
  const [roomId, setRoomId] = useState(sp.get("roomId") ?? "");
  const [doctorId, setDoctorId] = useState(sp.get("doctorId") ?? "");
  const [productId, setProductId] = useState(sp.get("productId") ?? "");
  const [scope, setScope] = useState(sp.get("scope") === "all" ? "all" : "tenant");
  const [view, setView] = useState(sp.get("view") ?? "resumen");

  const f: Filters = useMemo(() => ({ from, to, centerId, roomId, doctorId, productId, scope }),
    [from, to, centerId, roomId, doctorId, productId, scope]);

  // Persistir filtros en la URL.
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("from", from); p.set("to", to);
    if (view !== "resumen") p.set("view", view);
    if (scope === "all") p.set("scope", "all");
    if (centerId) p.set("centerId", centerId);
    if (roomId) p.set("roomId", roomId);
    if (doctorId) p.set("doctorId", doctorId);
    if (productId) p.set("productId", productId);
    router.replace(`/analitica?${p.toString()}`, { scroll: false });
  }, [from, to, centerId, roomId, doctorId, productId, scope, view, router]);

  // Datos de los desplegables de filtro.
  const { data: centers } = useQuery<CenterOpt[]>({ queryKey: ["an-centers"], queryFn: () => apiFetch("/centers"), staleTime: 5 * 60_000 });
  const { data: doctors } = useQuery<DoctorOpt[]>({ queryKey: ["an-doctors"], queryFn: () => apiFetch("/doctors"), staleTime: 5 * 60_000 });
  const { data: products } = useQuery<ProductOpt[]>({ queryKey: ["an-products"], queryFn: () => apiFetch("/products"), staleTime: 5 * 60_000 });
  const rooms = useMemo(() => (centers ?? []).find((c) => c.id === centerId)?.rooms ?? [], [centers, centerId]);

  if (user && !isSuper && user.role !== "ADMIN") {
    return <div className="p-6 text-sm text-gray-500">Esta sección es solo para administradores.</div>;
  }

  const setPreset = (days: number | "year") => {
    if (days === "year") { setFrom(`${new Date().getFullYear()}-01-01`); setTo(today); }
    else { setFrom(addDays(today, -(days - 1))); setTo(today); }
  };

  return (
    <div className="p-6 max-w-6xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">Analítica de gestión</h1>
        {isSuper && (
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {([["tenant", "Empresa actual"], ["all", "Plataforma (todas)"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setScope(v)}
                className={`px-3 py-1.5 ${scope === v ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {/* Barra de filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex gap-1.5">
          {([["30d", 30], ["90d", 90], ["Año", "year"]] as const).map(([l, d]) => (
            <button key={l} onClick={() => setPreset(d)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">{l}</button>
          ))}
        </div>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 uppercase">Desde</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1" /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 uppercase">Hasta</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1" /></label>
        {scope !== "all" && (
          <label className="flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 uppercase">Centro</span>
            <select value={centerId} onChange={(e) => { setCenterId(e.target.value); setRoomId(""); }} className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
              <option value="">Todos</option>
              {(centers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        )}
        {scope !== "all" && centerId && rooms.length > 0 && (
          <label className="flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 uppercase">Sala</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
              <option value="">Todas</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
        )}
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 uppercase">Médico</span>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
            <option value="">Todos</option>
            {(doctors ?? []).map((d) => <option key={d.id} value={d.id}>{`${d.firstName ?? ""} ${d.lastName ?? ""}`.trim() || d.id}</option>)}
          </select></label>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 uppercase">Producto</span>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
            <option value="">Todos</option>
            {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
      </div>

      {/* Pestañas de vista */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${view === v.id ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "resumen" && <Resumen f={f} onDrillCenter={(id) => { setCenterId(id); setView("comparativa"); }} />}
      {view === "embudo" && <EmbudoView f={f} />}
      {view === "ocupacion" && <OcupacionView f={f} />}
      {view === "saturacion" && <SaturacionView f={f} />}
      {view === "medicos" && <MedicosView f={f} />}
      {view === "comparativa" && <ComparativaView f={f} onDrillCenter={(id) => setCenterId(id)} />}
      {view === "volumen" && <VolumenView f={f} />}
    </div>
  );
}

// ── Hook de consulta ─────────────────────────────────────────────────────────
function useReport<T>(ep: string, f: Filters, extra?: Record<string, string>) {
  const qs = buildQs(f, extra);
  return useQuery<T>({ queryKey: [ep, qs], queryFn: () => apiFetch<T>(`/analytics/${ep}?${qs}`) });
}

// ── Vista: Resumen (KPIs + alertas + comparación) ────────────────────────────
function Resumen({ f, onDrillCenter }: { f: Filters; onDrillCenter: (id: string) => void }) {
  const prev = prevPeriod(f);
  const prevF: Filters = { ...f, from: prev.from, to: prev.to };
  const funnel = useReport<Funnel>("funnel", f);
  const funnelPrev = useReport<Funnel>("funnel", prevF);
  const occ = useReport<Occupancy>("occupancy", f);
  const occPrev = useReport<Occupancy>("occupancy", prevF);
  const sat = useReport<SatBucket[]>("saturation", f, { granularity: "day" });

  const cur = funnel.data, pre = funnelPrev.data;
  const conv = (x?: Funnel) => (x && x.reservas > 0 ? Math.round((x.atendidas / x.reservas) * 1000) / 10 : 0);
  const convCur = conv(cur), convPre = conv(pre);
  const occCur = occ.data?.total.ocupacion ?? 0, occPre = occPrev.data?.total.ocupacion ?? 0;
  const satDays = (sat.data ?? []).filter((b) => b.saturado).length;
  const satPeak = (sat.data ?? []).reduce((m, b) => Math.max(m, b.saturacion), 0);

  // Alertas orientadas a decisión.
  const alerts: { text: string; tone: "danger" | "warning" }[] = [];
  if (satDays > 0) alerts.push({ text: `${satDays} día(s) saturado(s) (pico ${satPeak}%) — considera ampliar disponibilidad`, tone: "danger" });
  if (cur && convCur < 60 && cur.reservas >= 5) alerts.push({ text: `Conversión ${convCur}% por debajo del objetivo (60%)`, tone: "warning" });
  if (cur && cur.tasas.noShow > 10) alerts.push({ text: `No-show ${cur.tasas.noShow}% por encima del umbral (10%)`, tone: "warning" });
  if (cur && cur.fugas.canceladasCliente > 0) alerts.push({ text: `${cur.fugas.canceladasCliente} cancelación(es) de cliente — oportunidad de recaptura`, tone: "warning" });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Percent} label="Conversión (atendidas/reservas)" value={convCur} suffix="%" delta={convCur - convPre} goodWhenUp tone="success" />
        <Kpi icon={DoorOpen} label="Ocupación media" value={occCur} suffix="%" delta={occCur - occPre} goodWhenUp tone="accent" />
        <Kpi icon={Gauge} label="Saturación pico" value={satPeak} suffix="%" tone={satDays > 0 ? "danger" : "plain"} />
        <Kpi icon={UserX} label="No-show" value={cur?.tasas.noShow ?? 0} suffix="%" delta={cur && pre ? cur.tasas.noShow - pre.tasas.noShow : null} goodWhenUp={false} tone="warning" />
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${a.tone === "danger" ? "bg-red-50 border-red-100 text-red-700" : "bg-amber-50 border-amber-100 text-amber-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0" /> {a.text}
            </div>
          ))}
        </div>
      )}

      {/* Mini embudo + salas top */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Embudo del periodo">
          {cur ? <FunnelBars f={cur} /> : empty}
        </Card>
        <Card title="Ocupación por sala">
          {(occ.data?.salas.length ?? 0) === 0 ? empty : (
            <div className="space-y-1.5">
              {occ.data!.salas.slice(0, 6).map((s) => (
                <button key={s.roomId} onClick={() => onDrillCenter(s.centerId)} className="w-full flex items-center gap-2 text-sm group">
                  <span className="w-28 truncate text-left text-gray-600 group-hover:text-blue-600">{s.roomName}</span>
                  <span className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, s.ocupacion)}%`, backgroundColor: s.ocupacion >= 90 ? "#ef4444" : "#3b82f6" }} />
                  </span>
                  <span className="w-12 text-right tabular-nums text-gray-700">{s.ocupacion}%</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// Barras del embudo (reutilizable).
function FunnelBars({ f }: { f: Funnel }) {
  const stages = [
    { label: "Reservas", value: f.reservas, color: "#93c5fd" },
    { label: "Confirmadas", value: f.confirmadas, color: "#60a5fa" },
    { label: "Atendidas", value: f.atendidas, color: "#3b82f6" },
    { label: "Visitas completadas", value: f.visitasCompletadas, color: "#2563eb" },
  ];
  const max = Math.max(1, f.reservas);
  return (
    <div className="space-y-2">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-sm">
          <span className="w-36 text-gray-600">{s.label}</span>
          <span className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
            <span className="block h-full rounded" style={{ width: `${(s.value / max) * 100}%`, backgroundColor: s.color }} />
          </span>
          <span className="w-10 text-right tabular-nums font-medium text-gray-800">{s.value}</span>
        </div>
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 pt-2 border-t border-gray-100">
        <span>Confirmación <b className="text-gray-700">{f.tasas.confirmacion}%</b></span>
        <span>Atención <b className="text-gray-700">{f.tasas.atencion}%</b></span>
        <span>No-show <b className="text-gray-700">{f.tasas.noShow}%</b></span>
        <span>Cancelación <b className="text-gray-700">{f.tasas.cancelacion}%</b></span>
      </div>
    </div>
  );
}

// ── Vista: Embudo ────────────────────────────────────────────────────────────
function EmbudoView({ f }: { f: Filters }) {
  const { data } = useReport<Funnel>("funnel", f);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Embudo de conversión" action={<CsvButton ep="funnel" f={f} />}>
        {data ? <FunnelBars f={data} /> : empty}
      </Card>
      <Card title="Fugas del periodo">
        {data ? (
          <div className="space-y-1.5 text-sm">
            {[
              ["Canceladas · cliente", data.fugas.canceladasCliente, "recaptura"],
              ["Canceladas · centro", data.fugas.canceladasCentro, "operativo"],
              ["Canceladas · otras", data.fugas.canceladasOtras, ""],
              ["Reprogramadas", data.fugas.reprogramadas, ""],
              ["No-show", data.fugas.noShow, ""],
              ["Se fue (sin atender)", data.fugas.seFue, ""],
            ].map(([label, val, note]) => (
              <div key={label as string} className="flex items-center justify-between border-b border-gray-50 py-1">
                <span className="text-gray-600">{label}{note ? <span className="text-[10px] text-gray-400 ml-1.5">· {note}</span> : null}</span>
                <span className="font-medium tabular-nums text-gray-800">{val as number}</span>
              </div>
            ))}
            {data.ruido > 0 && <p className="text-[11px] text-gray-400 pt-1">Excluidas de las tasas: {data.ruido} canceladas por duplicado/error (ruido).</p>}
          </div>
        ) : empty}
      </Card>
    </div>
  );
}

// ── Vista: Ocupación ─────────────────────────────────────────────────────────
function OcupacionView({ f }: { f: Filters }) {
  const { data } = useReport<Occupancy>("occupancy", f);
  const rows = (data?.salas ?? []).map((s) => ({ ...s, label: s.roomName }));
  return (
    <Card title={`Ocupación por sala · total ${data?.total.ocupacion ?? 0}%`} action={<CsvButton ep="occupancy" f={f} />}>
      {rows.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 40)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} unit="%" />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
              formatter={(v: number, _n, p) => [`${v}% (${p.payload.usados}/${p.payload.disponibles})`, "Ocupación"]} />
            <Bar dataKey="ocupacion" radius={[0, 4, 4, 0]} maxBarSize={24}>
              {rows.map((r) => <Cell key={r.roomId} fill={r.ocupacion >= 90 ? "#ef4444" : "#3b82f6"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Vista: Saturación ────────────────────────────────────────────────────────
function SaturacionView({ f }: { f: Filters }) {
  const [g, setG] = useState("day");
  const { data } = useReport<SatBucket[]>("saturation", f, { granularity: g });
  const rows = (data ?? []).map((b) => ({ ...b, label: bucketLabel(b.bucket) }));
  return (
    <Card title="Saturación de la demanda"
      action={
        <div className="flex items-center gap-2">
          <select value={g} onChange={(e) => setG(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
            <option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option>
          </select>
          <CsvButton ep="saturation" f={f} extra={{ granularity: g }} />
        </div>
      }>
      {rows.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} unit="%" width={40} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
              formatter={(v: number, _n, p) => [`${v}% (${p.payload.demanda}/${p.payload.capacidad})`, "Saturación"]} />
            <Bar dataKey="saturacion" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {rows.map((r) => <Cell key={r.bucket} fill={r.saturado ? "#ef4444" : "#3b82f6"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="text-[11px] text-gray-400 mt-2">Demanda (reservas) frente a capacidad (slots ofertados). Rojo = ≥ 90% (saturado).</p>
    </Card>
  );
}

// ── Vista: Médicos ───────────────────────────────────────────────────────────
function MedicosView({ f }: { f: Filters }) {
  const { data } = useReport<DoctorRow[]>("doctors", f);
  return (
    <Card title="Rendimiento por médico" action={<CsvButton ep="doctors" f={f} />}>
      {(data?.length ?? 0) === 0 ? empty : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 font-medium">Médico</th><th className="py-2 font-medium text-right">Visitas</th>
              <th className="py-2 font-medium text-right">Pacientes</th><th className="py-2 font-medium text-right">Aptitud</th>
              <th className="py-2 font-medium text-right">Tiempo medio</th>
            </tr></thead>
            <tbody>
              {data!.map((d) => (
                <tr key={d.doctorId} className="border-b border-gray-50">
                  <td className="py-2 flex items-center gap-1.5 text-gray-700"><Stethoscope className="w-3.5 h-3.5 text-gray-400" />{d.doctorName}</td>
                  <td className="py-2 text-right tabular-nums">{d.visitasAtendidas}</td>
                  <td className="py-2 text-right tabular-nums">{d.pacientesDistintos}</td>
                  <td className="py-2 text-right tabular-nums">{d.tasaAptitud == null ? "—" : `${d.tasaAptitud}%`}</td>
                  <td className="py-2 text-right tabular-nums">{d.tiempoMedioMin == null ? "—" : `${d.tiempoMedioMin} min`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Vista: Comparativa (con drill-down por centro) ───────────────────────────
function ComparativaView({ f, onDrillCenter }: { f: Filters; onDrillCenter: (id: string) => void }) {
  const { data } = useReport<Comparison>("comparison", f);
  const table = (rows: CompRow[], drill?: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
          <th className="py-2 font-medium">Nombre</th><th className="py-2 font-medium text-right">Reservas</th>
          <th className="py-2 font-medium text-right">Atendidas</th><th className="py-2 font-medium text-right">Conversión</th>
          <th className="py-2 font-medium text-right">Ocupación</th>{drill && <th />}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-b border-gray-50 ${drill ? "cursor-pointer hover:bg-blue-50/50" : ""}`} onClick={drill ? () => onDrillCenter(r.id) : undefined}>
              <td className="py-2 text-gray-700">{r.name}{r.centerName ? <span className="text-[10px] text-gray-400 ml-1.5">· {r.centerName}</span> : null}</td>
              <td className="py-2 text-right tabular-nums">{r.reservas}</td>
              <td className="py-2 text-right tabular-nums">{r.atendidas}</td>
              <td className="py-2 text-right tabular-nums">{r.conversion}%</td>
              <td className="py-2 text-right tabular-nums">{r.ocupacion}%</td>
              {drill && <td className="py-2 text-right"><ChevronRight className="w-4 h-4 text-gray-300 inline" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-4">
      <Card title="Comparativa entre centros" action={<CsvButton ep="comparison" f={f} />}>
        {(data?.porCentro.length ?? 0) === 0 ? empty : table(data!.porCentro, true)}
      </Card>
      <Card title="Comparativa entre salas">
        {(data?.porSala.length ?? 0) === 0 ? empty : table(data!.porSala)}
      </Card>
    </div>
  );
}

// ── Vista: Volumen ───────────────────────────────────────────────────────────
function VolumenView({ f }: { f: Filters }) {
  const [g, setG] = useState("month");
  const { data } = useReport<VolBucket[]>("volume", f, { granularity: g });
  const rows = (data ?? []).map((b) => ({ ...b, label: bucketLabel(b.bucket) }));
  return (
    <Card title="Volumen de reservas y visitas"
      action={
        <div className="flex items-center gap-2">
          <select value={g} onChange={(e) => setG(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
            <option value="month">Mes</option><option value="year">Año</option>
          </select>
          <CsvButton ep="volume" f={f} extra={{ granularity: g }} />
        </div>
      }>
      {rows.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="reservas" name="Reservas" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="visitas" name="Visitas" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
