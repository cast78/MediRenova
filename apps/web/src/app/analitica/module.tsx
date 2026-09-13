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
import { ClientInfoModal } from "@/components/client-info-modal";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Percent, DoorOpen, Gauge, UserX, Download, AlertTriangle, ChevronRight, Stethoscope,
  UserPlus, Users, Send, CheckCircle, Building2, Package, ChevronDown, X, Calendar,
} from "lucide-react";

// ── Tipos que devuelve la API ────────────────────────────────────────────────
interface Funnel {
  reservas: number; confirmadas: number; atendidas: number; visitasCompletadas: number;
  fugas: { canceladasCliente: number; canceladasCentro: number; canceladasOtras: number; reprogramadas: number; noShow: number; seFue: number };
  ruido: number; tasas: { confirmacion: number; atencion: number; noShow: number; cancelacion: number };
  // Episodios sin cerrar: aislados de las tasas clínicas pero visibles.
  sinResolver?: number; completadasFueraDePlazo?: number;
}

// Drill-down de fugas: tipos y caso individual (endpoint /analytics/funnel/leaks).
type LeakType =
  | "no_show" | "cancel_cliente" | "cancel_centro" | "cancel_otras"
  | "reprogramada" | "se_fue" | "sin_resolver" | "fuera_de_plazo";
interface LeakCase {
  id: string; appointmentId: string | null; customerId: string | null; customer: string; date: string;
  product: string | null; room: string | null; center: string | null; note: string | null;
}

// Avatar de iniciales con color estable por nombre (mismo estilo que la lista de clientes).
const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500",
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function nameInitials(full: string): string {
  const p = full.trim().split(/\s+/).filter(Boolean);
  const a = p[0]?.[0] ?? "";
  const b = p[1]?.[0] ?? "";
  return ((a + b) || p[0]?.slice(0, 2) || "?").toUpperCase();
}
function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span className={`w-6 h-6 rounded-full ${muted ? "bg-gray-300" : avatarColor(name)} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
      {nameInitials(name)}
    </span>
  );
}
interface OccRow { roomId: string; roomName: string; centerId: string; centerName: string; disponibles: number; usados: number; ocupacion: number }
interface Occupancy { salas: OccRow[]; total: { disponibles: number; usados: number; ocupacion: number } }
interface SatBucket { bucket: string; demanda: number; capacidad: number; saturacion: number; saturado: boolean }
interface DoctorRow { doctorId: string; doctorName: string; visitasAtendidas: number; pacientesDistintos: number; apto: number; noApto: number; tasaAptitud: number | null; tiempoMedioMin: number | null }
interface CompRow { id: string; name: string; centerName?: string; reservas: number; atendidas: number; conversion: number; ocupacion: number }
interface Comparison { porCentro: CompRow[]; porSala: CompRow[] }
interface VolBucket { bucket: string; reservas: number; visitas: number }
interface AcquisitionResult { series: { bucket: string; total: number; canales: Record<string, number> }[]; nuevosVsRecurrentes: { nuevos: number; recurrentes: number } }
interface CampaignEffRow { campaignId: string; name: string; enviados: number; convertidos: number; tasaConversion: number; reservasAtribuidas: number; visitasAtribuidas: number }

interface Filters { from: string; to: string; centerId: string; roomId: string; doctorId: string; productId: string; scope: string }

// Canales de captación (proxy: source de la 1ª cita).
const CHANNEL_META: Record<string, { label: string; color: string }> = {
  BACKOFFICE: { label: "Backoffice", color: "#3b82f6" },
  MAGIC_LINK: { label: "Enlace", color: "#10b981" },
  API: { label: "API", color: "#8b5cf6" },
  WALK_IN: { label: "Sin cita previa", color: "#f59e0b" },
  SIN_CITA: { label: "Sin cita", color: "#9ca3af" },
};

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
// Fecha legible "1 ene 2026" (el año es opcional para no repetirlo en un rango del mismo año).
function fmtDate(s: string, withYear = true): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const label = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]!.toLowerCase()}`;
  return withYear ? `${label} ${m[1]}` : label;
}

// ── Componentes de presentación ──────────────────────────────────────────────
const TONE: Record<string, string> = {
  plain: "bg-white border-gray-200 text-gray-800",
  accent: "bg-blue-50 border-blue-100 text-blue-700",
  warning: "bg-amber-50 border-amber-100 text-amber-700",
  success: "bg-emerald-50 border-emerald-100 text-emerald-700",
  danger: "bg-red-50 border-red-100 text-red-700",
};

function Kpi({ icon: Icon, label, value, delta, goodWhenUp, tone = "plain", suffix, note }: {
  icon: typeof Percent; label: string; value: string | number; delta?: number | null;
  goodWhenUp?: boolean; tone?: keyof typeof TONE; suffix?: string; note?: string;
}) {
  const showDelta = delta != null && Number.isFinite(delta) && Math.abs(delta) >= 0.05;
  const up = (delta ?? 0) > 0;
  const good = goodWhenUp ? up : !up;
  return (
    <div className={`rounded-xl border px-4 py-3 ${TONE[tone]}`}>
      <p className={`text-xs font-medium mb-0.5 flex items-center gap-1.5 ${tone === "plain" ? "text-gray-500" : ""}`}>
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="text-2xl font-bold">{value}{suffix}{note && <span className="text-xs font-normal text-gray-400 ml-1.5">· {note}</span>}</p>
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

// Desplegable de filtro con icono y etiqueta (barra de filtros, Opción B).
function FilterSelect({ label, icon: Icon, value, onChange, options }: {
  label: string; icon: typeof Percent; value: string; onChange: (v: string) => void;
  options: { v: string; t: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[150px] flex-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</span>
      <div className="relative flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 focus-within:border-blue-400 transition-colors">
        <Icon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="appearance-none bg-transparent text-[12.5px] text-gray-700 flex-1 outline-none py-2 pr-5 cursor-pointer">
          {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 pointer-events-none" />
      </div>
    </label>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
// El mismo motor sirve dos módulos: "gestion" (analítica operativa de centros) y
// "captacion" (comercial). Cada uno muestra sus propias pestañas.
type Mod = "gestion" | "captacion";
const VIEWS_GESTION = [
  { id: "resumen", label: "Resumen" },
  { id: "embudo", label: "Embudo" },
  { id: "ocupacion", label: "Ocupación" },
  { id: "saturacion", label: "Saturación" },
  { id: "medicos", label: "Médicos" },
  { id: "comparativa", label: "Comparativa" },
  { id: "volumen", label: "Volumen" },
];
const VIEWS_CAPTACION = [
  { id: "resumen", label: "Resumen" },
  { id: "altas", label: "Altas" },
  { id: "campanas", label: "Campañas" },
];
const MOD_META: Record<Mod, { views: { id: string; label: string }[]; title: string; base: string }> = {
  gestion: { views: VIEWS_GESTION, title: "Analítica de gestión", base: "/analitica" },
  captacion: { views: VIEWS_CAPTACION, title: "Captación", base: "/captacion" },
};

export function AnalyticsModule({ mod }: { mod: Mod }) {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">Cargando…</div>}>
      <AnaliticaInner mod={mod} />
    </Suspense>
  );
}

function AnaliticaInner({ mod }: { mod: Mod }) {
  const { views, title, base } = MOD_META[mod];
  const defaultView = views[0]!.id;
  // Los filtros de entidad (centro/sala/médico/producto) sólo afectan a la analítica
  // de gestión; la captación agrega por tenant (altas y campañas por segmento), así
  // que se ocultan para no mostrar controles que no filtran nada.
  const showEntityFilters = mod === "gestion";
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
  const [view, setView] = useState(sp.get("view") ?? defaultView);
  const [showCustom, setShowCustom] = useState(false);

  const f: Filters = useMemo(() => ({ from, to, centerId, roomId, doctorId, productId, scope }),
    [from, to, centerId, roomId, doctorId, productId, scope]);

  // Persistir filtros en la URL.
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("from", from); p.set("to", to);
    if (view !== defaultView) p.set("view", view);
    if (scope === "all") p.set("scope", "all");
    if (centerId) p.set("centerId", centerId);
    if (roomId) p.set("roomId", roomId);
    if (doctorId) p.set("doctorId", doctorId);
    if (productId) p.set("productId", productId);
    router.replace(`${base}?${p.toString()}`, { scroll: false });
  }, [from, to, centerId, roomId, doctorId, productId, scope, view, router, base, defaultView]);

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

  // ── Resumen del periodo (barra de filtros, Opción B) ──
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const activePreset: number | "year" | null =
    to !== today ? null
      : from === yearStart ? "year"
      : from === addDays(today, -29) ? 30
      : from === addDays(today, -89) ? 90
      : null;
  const periodLabel = activePreset === "year" ? "Este año"
    : activePreset === 30 ? "Últimos 30 días"
    : activePreset === 90 ? "Últimos 90 días"
    : "Rango personalizado";
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const periodRange = `${fmtDate(from, !sameYear)} → ${fmtDate(to)} · ${daysBetween(from, to)} días`;
  const datesVisible = showCustom || activePreset === null;

  // Chips de filtros activos (solo gestión).
  const doctorObj = (doctors ?? []).find((d) => d.id === doctorId);
  const activeChips = ([
    centerId && { label: "Centro", value: (centers ?? []).find((c) => c.id === centerId)?.name ?? centerId, clear: () => { setCenterId(""); setRoomId(""); } },
    roomId && { label: "Sala", value: rooms.find((r) => r.id === roomId)?.name ?? roomId, clear: () => setRoomId("") },
    doctorId && { label: "Médico", value: (`${doctorObj?.firstName ?? ""} ${doctorObj?.lastName ?? ""}`.trim() || doctorId), clear: () => setDoctorId("") },
    productId && { label: "Producto", value: (products ?? []).find((p) => p.id === productId)?.name ?? productId, clear: () => setProductId("") },
  ].filter(Boolean) as { label: string; value: string; clear: () => void }[]);
  const clearAll = () => { setCenterId(""); setRoomId(""); setDoctorId(""); setProductId(""); };

  return (
    <div className="p-6 max-w-6xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {isSuper && (
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {([["tenant", "Empresa actual"], ["all", "Plataforma (todas)"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setScope(v)}
                className={`px-3 py-1.5 ${scope === v ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {/* Barra de filtros (Opción B: resumen de periodo + desplegables + chips) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Cabecera: resumen del periodo + atajos de rango */}
        <div className="flex items-end justify-between gap-3 flex-wrap p-3 bg-gradient-to-b from-gray-50/70 to-transparent">
          <div>
            <div className="text-[15px] font-bold tracking-tight text-gray-900">{periodLabel}</div>
            <div className="text-[11px] text-gray-500 mt-0.5 tabular-nums">{periodRange}</div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {([["30d", 30], ["90d", 90], ["Año", "year"]] as const).map(([l, d]) => (
              <button key={l} onClick={() => { setPreset(d); setShowCustom(false); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${activePreset === d ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-gray-800"}`}>{l}</button>
            ))}
            <button onClick={() => setShowCustom((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${datesVisible ? "bg-blue-50 border-blue-100 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:border-blue-300"}`}>
              <Calendar className="w-3.5 h-3.5" /> Personalizar
            </button>
          </div>
        </div>

        {/* Fechas (se revelan con Personalizar o cuando el rango no coincide con un atajo) */}
        {datesVisible && (
          <div className="flex flex-wrap items-end gap-3 px-3 pb-3 text-sm">
            <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Desde</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50" /></label>
            <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Hasta</span>
              <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50" /></label>
          </div>
        )}

        {/* Filtros de entidad (solo Analítica de gestión; Captación agrega por empresa) */}
        {showEntityFilters && scope !== "all" && (
          <div className="flex flex-wrap gap-2.5 px-3 pb-3">
            <FilterSelect label="Centro" icon={Building2} value={centerId} onChange={(v) => { setCenterId(v); setRoomId(""); }}
              options={[{ v: "", t: "Todos los centros" }, ...(centers ?? []).map((c) => ({ v: c.id, t: c.name }))]} />
            {centerId && rooms.length > 0 && (
              <FilterSelect label="Sala" icon={DoorOpen} value={roomId} onChange={setRoomId}
                options={[{ v: "", t: "Todas" }, ...rooms.map((r) => ({ v: r.id, t: r.name }))]} />
            )}
            <FilterSelect label="Médico" icon={Stethoscope} value={doctorId} onChange={setDoctorId}
              options={[{ v: "", t: "Todos" }, ...(doctors ?? []).map((d) => ({ v: d.id, t: `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim() || d.id }))]} />
            <FilterSelect label="Producto" icon={Package} value={productId} onChange={setProductId}
              options={[{ v: "", t: "Todos" }, ...(products ?? []).map((p) => ({ v: p.id, t: p.name }))]} />
          </div>
        )}

        {/* Fila de chips: filtros activos / alcance (solo Analítica de gestión) */}
        {showEntityFilters && (
          <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-t border-dashed border-gray-200 bg-gray-50/60">
            {scope === "all" ? (
              <span className="text-xs text-gray-400 italic">Alcance: plataforma · todas las empresas</span>
            ) : activeChips.length > 0 ? (
              <>
                <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400">Filtros</span>
                {activeChips.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700">
                    {c.label}: {c.value}
                    <button onClick={c.clear} className="opacity-60 hover:opacity-100" aria-label={`Quitar filtro ${c.label}`}><X className="w-3 h-3" /></button>
                  </span>
                ))}
                <button onClick={clearAll} className="ml-auto text-[11px] text-gray-500 hover:text-gray-700 underline underline-offset-2">Limpiar todo</button>
              </>
            ) : (
              <span className="text-xs text-gray-400 italic">Sin filtros aplicados · mostrando todos los centros</span>
            )}
          </div>
        )}
      </div>

      {/* Pestañas de vista. overflow-y-hidden evita la barra de scroll vertical
          fantasma que Windows dibuja (overflow-x:auto fuerza overflow-y:auto y las
          pestañas sobresalen ~1px por el subrayado). */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto overflow-y-hidden">
        {views.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${view === v.id ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "resumen" && (mod === "captacion"
        ? <ResumenCaptacion f={f} onGoTo={setView} />
        : <Resumen f={f} onDrillCenter={(id) => { setCenterId(id); setView("comparativa"); }} onGoTo={setView} />)}
      {view === "embudo" && <EmbudoView f={f} />}
      {view === "ocupacion" && <OcupacionView f={f} />}
      {view === "saturacion" && <SaturacionView f={f} />}
      {view === "medicos" && <MedicosView f={f} />}
      {view === "comparativa" && <ComparativaView f={f} onDrillCenter={(id) => setCenterId(id)} />}
      {view === "volumen" && <VolumenView f={f} />}
      {view === "altas" && <AltasView f={f} />}
      {view === "campanas" && <CampanasView f={f} />}
    </div>
  );
}

// ── Hook de consulta ─────────────────────────────────────────────────────────
function useReport<T>(ep: string, f: Filters, extra?: Record<string, string>) {
  const qs = buildQs(f, extra);
  return useQuery<T>({ queryKey: [ep, qs], queryFn: () => apiFetch<T>(`/analytics/${ep}?${qs}`) });
}

// Aptitud global del periodo = aptos / (aptos + no aptos), agregando por médico.
function aptitudFrom(rows?: DoctorRow[]): number | null {
  if (!rows) return null;
  let apto = 0, tot = 0;
  for (const r of rows) { apto += r.apto; tot += r.apto + r.noApto; }
  return tot > 0 ? Math.round((apto / tot) * 1000) / 10 : null;
}

// Sparkline de reservas vs visitas (tendencia del periodo).
function Sparkline({ data }: { data: VolBucket[] }) {
  if (data.length < 2) return <p className="text-xs text-gray-400 py-6 text-center">Datos insuficientes para la tendencia.</p>;
  const w = 300, h = 72, pad = 6;
  const max = Math.max(1, ...data.flatMap((d) => [d.reservas, d.visitas]));
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (data.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const line = (key: "reservas" | "visitas") => data.map((d, i) => `${Math.round(x(i))},${Math.round(y(d[key]))}`).join(" ");
  const last = data[data.length - 1]!;
  return (
    <div>
      <div className="flex gap-4 text-xs text-gray-500 mb-1">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#85B7EB" }} /> Reservas</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#185FA5" }} /> Visitas</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Tendencia de reservas y visitas en el periodo">
        <polyline fill="none" stroke="#85B7EB" strokeWidth="2" points={line("reservas")} />
        <polyline fill="none" stroke="#185FA5" strokeWidth="2" points={line("visitas")} />
        <circle cx={Math.round(x(data.length - 1))} cy={Math.round(y(last.reservas))} r="3" fill="#85B7EB" />
        <circle cx={Math.round(x(data.length - 1))} cy={Math.round(y(last.visitas))} r="3" fill="#185FA5" />
      </svg>
      <div className="flex justify-between text-[11px] text-gray-400 mt-0.5"><span>{f0(data[0]!.bucket)}</span><span>{f0(last.bucket)}</span></div>
    </div>
  );
}
const f0 = (b: string) => b.length >= 10 ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : b;

// ── Vista: Resumen (cockpit: constantes vitales + avisos + tendencia + ranking) ──
function Resumen({ f, onDrillCenter, onGoTo }: { f: Filters; onDrillCenter: (id: string) => void; onGoTo?: (v: string) => void }) {
  const prev = prevPeriod(f);
  const prevF: Filters = { ...f, from: prev.from, to: prev.to };
  const funnel = useReport<Funnel>("funnel", f);
  const funnelPrev = useReport<Funnel>("funnel", prevF);
  const occ = useReport<Occupancy>("occupancy", f);
  const occPrev = useReport<Occupancy>("occupancy", prevF);
  const sat = useReport<SatBucket[]>("saturation", f, { granularity: "day" });
  const doctors = useReport<DoctorRow[]>("doctors", f);
  const doctorsPrev = useReport<DoctorRow[]>("doctors", prevF);
  const volume = useReport<VolBucket[]>("volume", f, { granularity: "week" });

  const [leak, setLeak] = useState<{ type: LeakType; label: string } | null>(null);

  const cur = funnel.data, pre = funnelPrev.data;
  const conv = (x?: Funnel) => (x && x.reservas > 0 ? Math.round((x.atendidas / x.reservas) * 1000) / 10 : 0);
  const convCur = conv(cur), convPre = conv(pre);
  const occCur = occ.data?.total.ocupacion ?? 0, occPre = occPrev.data?.total.ocupacion ?? 0;
  const satDays = (sat.data ?? []).filter((b) => b.saturado).length;
  const satPeak = (sat.data ?? []).reduce((m, b) => Math.max(m, b.saturacion), 0);
  const aptCur = aptitudFrom(doctors.data), aptPre = aptitudFrom(doctorsPrev.data);
  const noAptoCur = (doctors.data ?? []).reduce((s, r) => s + r.noApto, 0);
  const revisadasCur = (doctors.data ?? []).reduce((s, r) => s + r.apto + r.noApto, 0);
  const aptNote = revisadasCur > 0 ? `${noAptoCur} no apto${noAptoCur !== 1 ? "s" : ""}` : undefined;
  const sinResolver = cur?.sinResolver ?? 0;

  // Top-2 fugas del periodo (para el mini "Dónde se pierde").
  const leakList = cur ? ([
    ["no_show", "No-show", cur.fugas.noShow],
    ["cancel_cliente", "Canceladas · cliente", cur.fugas.canceladasCliente],
    ["cancel_centro", "Canceladas · centro", cur.fugas.canceladasCentro],
    ["cancel_otras", "Canceladas · otras", cur.fugas.canceladasOtras],
    ["reprogramada", "Reprogramadas", cur.fugas.reprogramadas],
    ["se_fue", "Se fue", cur.fugas.seFue],
  ] as [LeakType, string, number][]).filter((x) => x[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 2) : [];

  // Alertas orientadas a decisión.
  const alerts: { text: string; tone: "danger" | "warning" }[] = [];
  if (satDays > 0) alerts.push({ text: `${satDays} día(s) saturado(s) (pico ${satPeak}%) — considera ampliar disponibilidad`, tone: "danger" });
  if (cur && convCur < 60 && cur.reservas >= 5) alerts.push({ text: `Conversión ${convCur}% por debajo del objetivo (60%)`, tone: "warning" });
  if (cur && cur.tasas.noShow > 10) alerts.push({ text: `No-show ${cur.tasas.noShow}% por encima del umbral (10%)`, tone: "warning" });
  if (aptCur != null && aptCur < 80) alerts.push({ text: `Aptitud ${aptCur}% por debajo del 80% — revisa los no aptos`, tone: "warning" });
  if (sinResolver > 0) alerts.push({ text: `${sinResolver} episodio(s) sin resolver (cierre administrativo) — revisa su origen`, tone: "warning" });
  if (cur && cur.fugas.canceladasCliente > 0) alerts.push({ text: `${cur.fugas.canceladasCliente} cancelación(es) de cliente — oportunidad de recaptura`, tone: "warning" });

  return (
    <div className="space-y-5">
      {/* Constantes vitales */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={CheckCircle} label="Atendidas" value={cur?.atendidas ?? 0} delta={cur && pre ? cur.atendidas - pre.atendidas : null} goodWhenUp tone="success" />
        <Kpi icon={Percent} label="Conversión" value={convCur} suffix="%" delta={convCur - convPre} goodWhenUp tone="accent" />
        <Kpi icon={UserX} label="No-show" value={cur?.tasas.noShow ?? 0} suffix="%" delta={cur && pre ? cur.tasas.noShow - pre.tasas.noShow : null} goodWhenUp={false} tone="warning" />
        <Kpi icon={DoorOpen} label="Ocupación" value={occCur} suffix="%" delta={occCur - occPre} goodWhenUp tone="plain" />
        <Kpi icon={Stethoscope} label="Aptitud" value={aptCur ?? "—"} suffix={aptCur != null ? "%" : ""} note={aptNote} delta={aptCur != null && aptPre != null ? aptCur - aptPre : null} goodWhenUp tone="plain" />
      </div>

      {alerts.length > 0 && (
        <div className="space-y-1">
          {alerts.map((a, i) => (
            <div key={i} className={`rounded-md border px-2.5 py-1 text-xs flex items-center gap-1.5 ${a.tone === "danger" ? "bg-red-50 border-red-100 text-red-700" : "bg-amber-50 border-amber-100 text-amber-700"}`}>
              <AlertTriangle className="w-3 h-3 shrink-0" /> {a.text}
            </div>
          ))}
        </div>
      )}

      {/* Tendencia + ranking de salas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tendencia" action={onGoTo && <button onClick={() => onGoTo("volumen")} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5">Ver volumen <ChevronRight className="w-3.5 h-3.5" /></button>}>
          {volume.data ? <Sparkline data={volume.data} /> : empty}
        </Card>
        <Card title="Rendimiento por sala" action={onGoTo && <button onClick={() => onGoTo("comparativa")} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5">Comparativa <ChevronRight className="w-3.5 h-3.5" /></button>}>
          {(occ.data?.salas.length ?? 0) === 0 ? empty : (
            <>
              <div className="space-y-0.5">
                {occ.data!.salas.slice(0, 6).map((s) => (
                  <button key={s.roomId} onClick={() => onDrillCenter(s.centerId)} title={`Ver ${s.centerName} en Comparativa`}
                    className="w-full flex items-center gap-2 text-sm group px-1.5 py-1 -mx-1.5 rounded-lg hover:bg-blue-50/60 cursor-pointer transition-colors">
                    <span className="w-24 truncate text-left text-gray-600 group-hover:text-blue-700 group-hover:underline underline-offset-2">{s.roomName}</span>
                    <span className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, s.ocupacion)}%`, backgroundColor: s.ocupacion >= 90 ? "#ef4444" : "#3b82f6" }} />
                    </span>
                    <span className="w-11 text-right tabular-nums text-gray-700">{s.ocupacion}%</span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-500 shrink-0" />
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">Clic en una sala → su centro en Comparativa</p>
            </>
          )}
        </Card>
      </div>

      {/* Mini "Dónde se pierde" → drill-down de fugas */}
      {cur && (
        <Card title="Dónde se pierde" action={onGoTo && <button onClick={() => onGoTo("embudo")} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5">Embudo <ChevronRight className="w-3.5 h-3.5" /></button>}>
          {leakList.length === 0 ? (
            <p className="text-sm text-gray-400">Sin fugas relevantes en el periodo.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {leakList.map(([type, label, val]) => (
                <button key={type} onClick={() => setLeak({ type, label })}
                  className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:text-blue-700 group">
                  <span className="text-gray-600 group-hover:text-blue-700">{label}</span>
                  <span className="font-bold tabular-nums text-gray-800 group-hover:text-blue-700">{val}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400" />
                </button>
              ))}
              <span className="text-[11px] text-gray-400 self-center">Pulsa para ver los casos detrás</span>
            </div>
          )}
        </Card>
      )}

      {leak && <LeakDrawer f={f} leak={leak} onClose={() => setLeak(null)} />}
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

  // Desglose del primer salto (Reservas→Confirmadas): las fugas terminales que
  // explican la caída. El resto se etiqueta como "pendientes" — honestidad: parte
  // del hueco son citas aún sin resolver, no fugas. Los saltos siguientes solo
  // muestran el Δ (su atribución no es limpia: "se fue" reparte según el estado
  // previo de la cita, y "visitas completadas" es a nivel de visita).
  const canceladas = f.fugas.canceladasCliente + f.fugas.canceladasCentro + f.fugas.canceladasOtras;
  function gapReasons(i: number, delta: number): string | null {
    if (i !== 0) return null;
    const parts: string[] = [];
    if (f.fugas.noShow > 0) parts.push(`no-show ${f.fugas.noShow}`);
    if (canceladas > 0) parts.push(`canceladas ${canceladas}`);
    if (f.fugas.reprogramadas > 0) parts.push(`reprog. ${f.fugas.reprogramadas}`);
    const pend = delta - (f.fugas.noShow + canceladas + f.fugas.reprogramadas);
    if (pend > 0) parts.push(`pendientes ${pend}`);
    return parts.length ? parts.join(" · ") : null;
  }

  return (
    <div className="space-y-1">
      {stages.map((s, i) => {
        const next = stages[i + 1];
        const delta = next ? s.value - next.value : 0;
        const reasons = next && delta > 0 ? gapReasons(i, delta) : null;
        return (
          <div key={s.label}>
            <div className="flex items-center gap-2 text-sm py-0.5">
              <span className="w-36 text-gray-600">{s.label}</span>
              <span className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                <span className="block h-full rounded" style={{ width: `${(s.value / max) * 100}%`, backgroundColor: s.color }} />
              </span>
              <span className="w-10 text-right tabular-nums font-medium text-gray-800">{s.value}</span>
            </div>
            {next && delta > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-gray-400 pl-36 py-0.5">
                <span className="inline-flex items-center gap-0.5 text-red-400 font-medium tabular-nums">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                  {delta}
                </span>
                {reasons && <span className="truncate">{reasons}</span>}
              </div>
            )}
          </div>
        );
      })}
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
// Fila de fuga: clicable si tiene casos (val>0) → abre el detalle (drill-down). Los
// valores y la flecha van en columnas de ancho fijo para que queden alineados en
// todas las filas (tengan acción o no).
function LeakRow({ label, val, note, onOpen }: { label: string; val: number; note?: string; onOpen?: () => void }) {
  const actionable = !!onOpen && val > 0;
  const inner = (
    <>
      <span className="flex-1 text-left text-gray-600">
        <span className={actionable ? "underline decoration-dotted decoration-gray-300 underline-offset-2 group-hover:decoration-blue-400 group-hover:text-blue-700" : ""}>{label}</span>
        {note ? <span className="text-[10px] text-gray-400 ml-1.5">· {note}</span> : null}
      </span>
      <span className="w-10 text-right tabular-nums font-medium text-gray-800">{val}</span>
      <span className="w-4 flex justify-center text-gray-300 group-hover:text-blue-400">
        {actionable && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>}
      </span>
    </>
  );
  return actionable ? (
    <button onClick={onOpen} className="w-full flex items-center gap-2 py-1 group">{inner}</button>
  ) : (
    <div className="flex items-center gap-2 py-1">{inner}</div>
  );
}

function EmbudoView({ f }: { f: Filters }) {
  const { data } = useReport<Funnel>("funnel", f);
  const [leak, setLeak] = useState<{ type: LeakType; label: string } | null>(null);
  const open = (type: LeakType, label: string) => setLeak({ type, label });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Embudo de conversión" action={<CsvButton ep="funnel" f={f} />}>
        {data ? <FunnelBars f={data} /> : empty}
      </Card>
      <Card title="Fugas del periodo">
        {data ? (
          <div className="text-sm divide-y divide-gray-50">
            <LeakRow label="Canceladas · cliente" note="recaptura" val={data.fugas.canceladasCliente} onOpen={() => open("cancel_cliente", "Canceladas · cliente")} />
            <LeakRow label="Canceladas · centro" note="operativo" val={data.fugas.canceladasCentro} onOpen={() => open("cancel_centro", "Canceladas · centro")} />
            <LeakRow label="Canceladas · otras" val={data.fugas.canceladasOtras} onOpen={() => open("cancel_otras", "Canceladas · otras")} />
            <LeakRow label="Reprogramadas" val={data.fugas.reprogramadas} onOpen={() => open("reprogramada", "Reprogramadas")} />
            <LeakRow label="No-show" val={data.fugas.noShow} onOpen={() => open("no_show", "No-show")} />
            <LeakRow label="Se fue (sin atender)" val={data.fugas.seFue} onOpen={() => open("se_fue", "Se fue (sin atender)")} />
            {data.ruido > 0 && <p className="text-[11px] text-gray-400 pt-1">Excluidas de las tasas: {data.ruido} canceladas por duplicado/error (ruido).</p>}
            {((data.sinResolver ?? 0) > 0 || (data.completadasFueraDePlazo ?? 0) > 0) && (
              <div className="mt-1 pt-2 space-y-0.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold pb-0.5">Episodios sin cerrar · aislados de las tasas</p>
                <LeakRow label="Sin resolver" note="cierre administrativo" val={data.sinResolver ?? 0} onOpen={() => open("sin_resolver", "Sin resolver")} />
                <LeakRow label="Completadas fuera de plazo" note="revisión tardía" val={data.completadasFueraDePlazo ?? 0} onOpen={() => open("fuera_de_plazo", "Completadas fuera de plazo")} />
              </div>
            )}
            <p className="text-[11px] text-gray-300 pt-2 border-t-0">Pulsa una fuga con casos para ver el detalle.</p>
          </div>
        ) : empty}
      </Card>
      {leak && <LeakDrawer f={f} leak={leak} onClose={() => setLeak(null)} />}
    </div>
  );
}

// Panel lateral con el detalle (lista de casos) de una fuga, respetando los filtros.
function LeakDrawer({ f, leak, onClose }: { f: Filters; leak: { type: LeakType; label: string }; onClose: () => void }) {
  const router = useRouter();
  const qs = buildQs(f, { type: leak.type });
  const { data: cases = [], isLoading, isError } = useQuery<LeakCase[]>({
    queryKey: ["funnel-leaks", qs],
    queryFn: () => apiFetch<LeakCase[]>(`/analytics/funnel/leaks?${qs}`),
  });
  const [client, setClient] = useState<string | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
        <div className="w-full max-w-md h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-bold text-gray-900">{leak.label}</h3>
              <p className="text-xs text-gray-500">{isLoading ? "Cargando…" : `${cases.length} caso${cases.length !== 1 ? "s" : ""}`} · {f.from} → {f.to}</p>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="p-8 text-sm text-gray-400 text-center">Cargando…</p>
            ) : isError ? (
              <p className="p-8 text-sm text-red-500 text-center">No se pudo cargar el detalle.</p>
            ) : cases.length === 0 ? (
              <p className="p-8 text-sm text-gray-400 text-center">Sin casos en este periodo/filtros.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {cases.map((c) => (
                  <div key={c.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      {c.customerId ? (
                        <button onClick={() => setClient(c.customerId)} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-2 min-w-0 text-left">
                          <Avatar name={c.customer} />
                          <span className="text-sm font-semibold text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2 truncate">{c.customer}</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <Avatar name={c.customer} muted />
                          <span className="text-sm font-semibold text-gray-900 truncate">{c.customer}</span>
                        </span>
                      )}
                      <span className="text-xs text-gray-400 shrink-0 tabular-nums">{new Date(c.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{[c.product, c.room, c.center].filter(Boolean).join(" · ") || "—"}</p>
                    {c.note && <p className="text-[11px] text-gray-400 truncate mt-0.5">{c.note}</p>}
                    {c.appointmentId && (
                      <button onClick={() => router.push(`/appointments?appt=${c.appointmentId}`)} className="mt-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1">
                        Ver reserva
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {cases.length >= 500 && <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-100">Mostrando los primeros 500 casos.</p>}
        </div>
      </div>
      {client && <ClientInfoModal customerId={client} onClose={() => setClient(null)} />}
    </>
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

// ── Vista: Resumen de captación (KPIs + alertas + navegación) ────────────────
// Consume sólo la API (acquisition + campaign-effectiveness); el periodo anterior
// de igual longitud alimenta los deltas, igual que el Resumen de gestión.
function ResumenCaptacion({ f, onGoTo }: { f: Filters; onGoTo: (view: string) => void }) {
  const prev = prevPeriod(f);
  const prevF: Filters = { ...f, from: prev.from, to: prev.to };
  const acq = useReport<AcquisitionResult>("acquisition", f, { granularity: "month" });
  const acqPrev = useReport<AcquisitionResult>("acquisition", prevF, { granularity: "month" });
  const eff = useReport<CampaignEffRow[]>("campaign-effectiveness", f, { attributionWindowDays: "30" });
  const effPrev = useReport<CampaignEffRow[]>("campaign-effectiveness", prevF, { attributionWindowDays: "30" });

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const altas = sum((acq.data?.series ?? []).map((b) => b.total));
  const altasPrev = sum((acqPrev.data?.series ?? []).map((b) => b.total));
  const nvr = acq.data?.nuevosVsRecurrentes;
  const nvrPrev = acqPrev.data?.nuevosVsRecurrentes;

  const rows = eff.data ?? [], rowsPrev = effPrev.data ?? [];
  const enviados = sum(rows.map((c) => c.enviados));
  const convertidos = sum(rows.map((c) => c.convertidos));
  const visitasAtrib = sum(rows.map((c) => c.visitasAtribuidas));
  const tasaMedia = enviados > 0 ? Math.round((convertidos / enviados) * 1000) / 10 : 0;
  const envPrev = sum(rowsPrev.map((c) => c.enviados));
  const tasaMediaPrev = envPrev > 0 ? Math.round((sum(rowsPrev.map((c) => c.convertidos)) / envPrev) * 1000) / 10 : 0;
  const best = rows[0]; // la API ya las devuelve ordenadas por convertidos desc

  const alerts: { text: string; tone: "danger" | "warning" | "success" }[] = [];
  if (rows.length === 0) alerts.push({ text: "No hay campañas enviadas en el periodo — sin datos de efectividad que mostrar", tone: "warning" });
  if (enviados >= 20 && tasaMedia < 10) alerts.push({ text: `Conversión media de campañas ${tasaMedia}% (baja para ${enviados} envíos) — revisa segmento, canal o mensaje`, tone: "warning" });
  if (best && best.convertidos > 0) alerts.push({ text: `Mejor campaña: "${best.name}" — ${best.convertidos} convertidos (${best.tasaConversion}%)`, tone: "success" });

  const loading = acq.isLoading || eff.isLoading;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={UserPlus} label="Altas del periodo" value={altas} delta={altas - altasPrev} goodWhenUp tone="success" />
        <Kpi icon={Users} label="Clientes nuevos" value={nvr?.nuevos ?? 0}
          delta={nvr && nvrPrev ? nvr.nuevos - nvrPrev.nuevos : null} goodWhenUp tone="accent" />
        <Kpi icon={Percent} label="Conversión media campañas" value={tasaMedia} suffix="%"
          delta={tasaMedia - tasaMediaPrev} goodWhenUp tone="plain" />
        <Kpi icon={CheckCircle} label="Visitas atribuidas" value={visitasAtrib} tone="plain" />
      </div>

      {nvr && (nvr.nuevos + nvr.recurrentes) > 0 && (
        <p className="text-xs text-gray-500">
          Reparto de clientes activos: <span className="font-medium text-gray-700">{nvr.nuevos} nuevos</span> ·{" "}
          <span className="font-medium text-gray-700">{nvr.recurrentes} recurrentes</span>
        </p>
      )}

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${
              a.tone === "danger" ? "bg-red-50 border-red-100 text-red-700"
                : a.tone === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                : "bg-amber-50 border-amber-100 text-amber-700"}`}>
              {a.tone === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />} {a.text}
            </div>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <button onClick={() => onGoTo("altas")}
          className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-colors flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><UserPlus className="w-4 h-4 text-blue-500" /> Ver altas por canal</span>
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </button>
        <button onClick={() => onGoTo("campanas")}
          className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-colors flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><Send className="w-4 h-4 text-blue-500" /> Ver efectividad de campañas</span>
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {loading && <p className="text-center text-gray-400 text-sm py-2">Cargando…</p>}
    </div>
  );
}

// ── Vista: Altas (captación) ─────────────────────────────────────────────────
function AltasView({ f }: { f: Filters }) {
  const [g, setG] = useState("month");
  const acq = useReport<AcquisitionResult>("acquisition", f, { granularity: g });
  const series = acq.data?.series ?? [];
  const channels = [...new Set(series.flatMap((b) => Object.keys(b.canales)))];
  const chartData = series.map((b) => ({ label: bucketLabel(b.bucket), ...b.canales }));
  const nvr = acq.data?.nuevosVsRecurrentes;
  return (
    <Card title="Altas de clientes por periodo y canal"
      action={
        <div className="flex items-center gap-2">
          <select value={g} onChange={(e) => setG(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
            <option value="month">Mes</option><option value="week">Semana</option><option value="year">Año</option>
          </select>
          <CsvButton ep="acquisition" f={f} extra={{ granularity: g }} />
        </div>
      }>
      {nvr && (
        <div className="flex gap-3 mb-4">
          <div className="rounded-xl border bg-emerald-50 border-emerald-100 text-emerald-700 px-4 py-2 flex-1">
            <p className="text-xs font-medium">Clientes nuevos</p><p className="text-2xl font-bold">{nvr.nuevos}</p>
          </div>
          <div className="rounded-xl border bg-blue-50 border-blue-100 text-blue-700 px-4 py-2 flex-1">
            <p className="text-xs font-medium">Recurrentes</p><p className="text-2xl font-bold">{nvr.recurrentes}</p>
          </div>
        </div>
      )}
      {series.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {channels.map((c) => (
              <Bar key={c} dataKey={c} stackId="a" name={CHANNEL_META[c]?.label ?? c} fill={CHANNEL_META[c]?.color ?? "#cbd5e1"} maxBarSize={40} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Vista: Campañas (efectividad, captación) ─────────────────────────────────
function CampanasView({ f }: { f: Filters }) {
  const [win, setWin] = useState("30");
  const eff = useReport<CampaignEffRow[]>("campaign-effectiveness", f, { attributionWindowDays: win });
  return (
    <Card title="Efectividad de campañas"
      action={
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 flex items-center gap-1">
            Ventana
            <select value={win} onChange={(e) => setWin(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
              {["7", "15", "30", "60", "90"].map((d) => <option key={d} value={d}>{d}d</option>)}
            </select>
          </label>
          <CsvButton ep="campaign-effectiveness" f={f} extra={{ attributionWindowDays: win }} />
        </div>
      }>
      {(eff.data?.length ?? 0) === 0 ? empty : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 font-medium">Campaña</th><th className="py-2 font-medium text-right">Enviados</th>
              <th className="py-2 font-medium text-right">Convertidos</th><th className="py-2 font-medium text-right">Tasa</th>
              <th className="py-2 font-medium text-right">Reservas atrib.</th><th className="py-2 font-medium text-right">Visitas atrib.</th>
            </tr></thead>
            <tbody>
              {eff.data!.map((c) => (
                <tr key={c.campaignId} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">{c.name}</td>
                  <td className="py-2 text-right tabular-nums">{c.enviados}</td>
                  <td className="py-2 text-right tabular-nums">{c.convertidos}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{c.tasaConversion}%</td>
                  <td className="py-2 text-right tabular-nums">{c.reservasAtribuidas}</td>
                  <td className="py-2 text-right tabular-nums">{c.visitasAtribuidas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-2">Atribución heurística: un envío cuenta como convertido si el cliente reservó dentro de la ventana (last-touch).</p>
    </Card>
  );
}
