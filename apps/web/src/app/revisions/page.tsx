"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch, authHeaders } from "@/lib/api";
import { useAppContext } from "@/components/context-bar";
import { RoomSelect } from "@/components/room-select";
import { ClientInfoModal } from "@/components/client-info-modal";
import { useAuth } from "@/lib/auth-context";
import { UserCircle, Search, ClipboardList, AlarmClock, CircleCheck, Percent, Bell, FileText, Copy, Check, CalendarCheck, History } from "lucide-react";

interface RevCenter { id: string; name: string; rooms?: { id: string; name: string }[] }

interface RevisionRow {
  id: string;
  outcome: string;
  completedAt: string | null;
  expiryDate: string | null;
  avisoCount: number;
  lastAvisoAt: string | null;
  appointment: {
    scheduledAt: string;
    customer: {
      id: string; firstName: string | null; lastName: string | null;
      phone: string | null; email: string | null; acceptsEmail: boolean; acceptsWhatsapp: boolean;
    };
    product: { id: string; name: string };
  };
}
interface RevisionList {
  data: RevisionRow[];
  meta: { page: number; limit: number; total: number; pages: number };
}

type View = "pending" | "expiring" | "history";
type Outcome = "all" | "APTO" | "NO_APTO";

const VIEWS: { key: View; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "expiring", label: "Próximas a caducar" },
  { key: "history", label: "Historial" },
];
const HISTORY_OUTCOMES: { key: Outcome; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "APTO", label: "Aptas" },
  { key: "NO_APTO", label: "No aptas" },
];
const EXPIRY_WINDOWS = [30, 60, 90, 365];

function outcomeBadge(outcome: string) {
  if (outcome === "APTO") return <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-50 text-green-700">Apto</span>;
  if (outcome === "NO_APTO") return <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-50 text-red-700">No apto</span>;
  return <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-50 text-amber-700">Pendiente</span>;
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

// "hoy" / "ayer" / "hace N días" a partir de una fecha (para el tooltip de avisos).
function avisoAgo(at: string | null): string {
  if (!at) return "";
  const d = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
}

// Tarjeta KPI clicable (también actúa como navegación a su vista). Con borde y color
// coherentes con el resto de páginas; la activa se resalta con acento.
type KpiTone = "neutral" | "red" | "blue" | "teal";
const KPI_TONES: Record<KpiTone, { bg: string; border: string; label: string; num: string; icon: string }> = {
  neutral: { bg: "bg-white", border: "border-gray-200", label: "text-gray-500", num: "text-gray-900", icon: "text-gray-400" },
  red: { bg: "bg-red-50", border: "border-red-100", label: "text-red-600", num: "text-red-700", icon: "text-red-500" },
  blue: { bg: "bg-blue-50", border: "border-blue-100", label: "text-blue-600", num: "text-blue-700", icon: "text-blue-500" },
  teal: { bg: "bg-teal-50", border: "border-teal-100", label: "text-teal-700", num: "text-teal-700", icon: "text-teal-600" },
};
function KpiCard({ label, value, sub, icon: Icon, tone, active, onClick }: {
  label: string; value: React.ReactNode; sub?: string | undefined; icon: typeof ClipboardList; tone: KpiTone; active: boolean; onClick: () => void;
}) {
  const t = KPI_TONES[tone];
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border p-3.5 transition-shadow ${t.bg} ${active ? "border-blue-500 ring-1 ring-blue-300" : t.border} hover:shadow-sm`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs ${t.label}`}>{label}</span>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <div className={`text-2xl font-semibold ${t.num} mt-0.5`}>
        {value}{sub && <span className="text-xs font-normal ml-1 opacity-70">{sub}</span>}
      </div>
    </button>
  );
}

// Píldora de días hasta la caducidad, con color según urgencia.
function ExpiryPill({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return null;
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);
  let cls = "bg-gray-100 text-gray-500";
  let text = `en ${days} días`;
  if (days < 0) { cls = "bg-red-50 text-red-700"; text = `vencido hace ${Math.abs(days)} d`; }
  else if (days <= 30) cls = "bg-red-50 text-red-700";
  else if (days <= 60) cls = "bg-amber-50 text-amber-700";
  return <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full ${cls}`}>{text}</span>;
}

// Rango YYYY-MM-DD del mes actual (para el drill-down de "completadas este mes").
function monthRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const s = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: s(start), to: s(now) };
}

// Normaliza un teléfono español para wa.me (prefijo 34 si son 9 dígitos).
function waPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("34")) return digits;
  if (digits.length === 9) return "34" + digits;
  return digits;
}

// Modal "Avisar de renovación": abre WhatsApp o Email con un mensaje prerrellenado,
// respetando el consentimiento de comunicación del cliente por canal.
function AvisarModal({ row, onClose }: { row: RevisionRow; onClose: () => void }) {
  const c = row.appointment.customer;
  const product = row.appointment.product.name;
  const expiry = row.expiryDate ? new Date(row.expiryDate).toLocaleDateString("es-ES") : "—";
  const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "cliente";
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  // Enlace de auto-reserva + contexto: cita futura ya reservada y último aviso enviado.
  const { data: link } = useQuery<{ url: string; futureAppointment: { scheduledAt: string } | null; lastAviso: { at: string; channel: string | null } | null }>({
    queryKey: ["renewal-link", row.id],
    queryFn: () => apiFetch(`/revisions/${row.id}/renewal-link`, { method: "POST" }),
  });
  const url = link?.url ?? null;
  const fut = link?.futureAppointment ?? null;
  const last = link?.lastAviso ?? null;
  const futWhen = fut
    ? `${new Date(`${fut.scheduledAt.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}, ${fut.scheduledAt.slice(11, 16)}`
    : "";
  const lastDays = last ? Math.floor((Date.now() - new Date(last.at).getTime()) / 86_400_000) : 0;
  const lastWhen = lastDays <= 0 ? "hoy" : lastDays === 1 ? "ayer" : `hace ${lastDays} días`;
  const CHAN_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", LINK: "enlace copiado" };

  // Registra el aviso: queda en el historial del cliente y actualiza "último aviso".
  async function logAviso(ch: "WHATSAPP" | "EMAIL" | "LINK") {
    try { await apiFetch(`/revisions/${row.id}/aviso`, { method: "POST", body: JSON.stringify({ channel: ch }) }); } catch { /* no crítico */ }
    void queryClient.invalidateQueries({ queryKey: ["renewal-link", row.id] });
    void queryClient.invalidateQueries({ queryKey: ["customer-timeline", c.id] });
    void queryClient.invalidateQueries({ queryKey: ["revisions"] }); // refresca el contador de la campana
  }

  const base = `Hola ${c.firstName ?? ""}, le recordamos que su certificado de ${product} caduca el ${expiry}.`;
  // Con enlace = mensaje real (WhatsApp/email). El preview no muestra el enlace crudo.
  const message = url ? `${base} Puede reservar su renovación aquí: ${url}` : base;
  const preview = `${base} Puede reservar su renovación desde el enlace.`;

  const waUrl = c.phone && url ? `https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(message)}` : null;
  const mailUrl = c.email && url ? `mailto:${c.email}?subject=${encodeURIComponent("Renovación de su certificado")}&body=${encodeURIComponent(message)}` : null;

  function channel(label: string, contact: string | null, consented: boolean, href: string | null, ch: "WHATSAPP" | "EMAIL") {
    const consentedContact = !!contact && consented;
    return (
      <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm text-gray-800">{label}</p>
          <p className="text-xs text-gray-400 truncate">
            {!contact ? `Sin ${label === "Email" ? "email" : "teléfono"} registrado` : !consented ? "Sin consentimiento del cliente" : contact}
          </p>
        </div>
        {consentedContact ? (
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => { void logAviso(ch); onClose(); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shrink-0">Abrir</a>
          ) : (
            <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-400 shrink-0">Generando…</span>
          )
        ) : (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-400 shrink-0">No disponible</span>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Avisar de renovación</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{name} · {product} · caduca {expiry}</p>

        {fut && (
          <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 mb-2">
            <CalendarCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-800">Ya tiene una cita de renovación reservada</p>
              <p className="text-[11px] text-amber-700 capitalize">{futWhen} · quizá no haga falta reavisar</p>
            </div>
          </div>
        )}
        {last && (
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-3">
            <History className="w-3.5 h-3.5" /> Último aviso: {lastWhen}{last.channel ? ` · ${CHAN_LABEL[last.channel] ?? last.channel}` : ""}
          </p>
        )}

        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 mb-4">{preview}</div>
        <div className="space-y-2">
          {channel("WhatsApp", c.phone, c.acceptsWhatsapp, waUrl, "WHATSAPP")}
          {channel("Email", c.email, c.acceptsEmail, mailUrl, "EMAIL")}
          <button
            onClick={() => { if (url) void navigator.clipboard?.writeText(url).then(() => { setCopied(true); void logAviso("LINK"); setTimeout(() => setCopied(false), 1500); }); }}
            disabled={!url}
            className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {copied ? <><Check className="w-4 h-4 text-green-600" /> Enlace copiado</> : <><Copy className="w-4 h-4" /> {url ? "Copiar enlace" : "Generando enlace…"}</>}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">Cada envío queda registrado en el historial del cliente. Solo se habilitan los canales que ha aceptado (RGPD).</p>
      </div>
    </div>
  );
}

export default function RevisionsPage() {
  const { centerId } = useAppContext();
  const { user } = useAuth();
  // Recepción ve la lista y puede avisar/imprimir certificado, pero no abre el
  // detalle clínico (formulario/notas) — eso es solo para médico/admin.
  const isClinical = user?.role === "DOCTOR" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  // El médico ve una versión enfocada: Pendientes (suyas, para cerrar) + Historial
  // (completo del paciente). Sin "próximas a caducar" ni "avisar" (eso es comercial).
  const isDoctor = user?.role === "DOCTOR";
  const views = isDoctor ? VIEWS.filter((v) => v.key !== "expiring") : VIEWS;

  // Estado inicial leído de la URL: al volver del detalle (router.back) se restaura
  // la vista y los filtros tal cual estaban (no vuelve a "Pendientes").
  const router = useRouter();
  const searchParams = useSearchParams();
  const qView = searchParams.get("view");
  const initialView: View = (["pending", "expiring", "history"] as const).includes(qView as never) ? (qView as View) : "pending";
  const qOutcome = searchParams.get("oc");
  const initialOutcome: Outcome = (["all", "APTO", "NO_APTO"].includes(qOutcome ?? "") ? qOutcome : "all") as Outcome;
  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [expiryDays, setExpiryDays] = useState(Number(searchParams.get("exp")) || 30);
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [roomFilter, setRoomFilter] = useState("");
  const [avisarRow, setAvisarRow] = useState<RevisionRow | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  // Centros (con salas) para el selector de sala; se acotan al centro global elegido.
  const { data: centersData } = useQuery<RevCenter[]>({
    queryKey: ["centers"],
    queryFn: () => apiFetch<RevCenter[]>("/centers"),
    staleTime: 5 * 60_000,
  });
  const roomCenters = centerId ? (centersData ?? []).filter((c) => c.id === centerId) : (centersData ?? []);
  // Al cambiar de centro, la sala elegida deja de aplicar → se resetea.
  useEffect(() => { setRoomFilter(""); }, [centerId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset de página al cambiar de vista, búsqueda o filtros.
  useEffect(() => { setPage(1); }, [view, debouncedSearch, expiryDays, outcome, from, to, centerId, roomFilter]);

  // Refleja vista + filtros en la URL (reemplaza, sin ensuciar el historial). Así al
  // abrir una revisión y volver (router.back) se recupera la vista exacta.
  useEffect(() => {
    const p = new URLSearchParams();
    if (view !== "pending") p.set("view", view);
    if (debouncedSearch) p.set("q", debouncedSearch);
    if (view === "expiring" && expiryDays !== 30) p.set("exp", String(expiryDays));
    if (view === "history") {
      if (outcome !== "all") p.set("oc", outcome);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    }
    router.replace(`/revisions${p.toString() ? `?${p.toString()}` : ""}`, { scroll: false });
  }, [view, debouncedSearch, expiryDays, outcome, from, to, router]);

  const { data, isLoading } = useQuery<RevisionList>({
    queryKey: ["revisions", view, debouncedSearch, page, expiryDays, outcome, from, to, centerId, roomFilter, isDoctor],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20", page: String(page) });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (view === "pending") params.set("outcome", "PENDING");
      // Pendientes del médico = solo las suyas. El historial NO se filtra por médico
      // (historia completa del paciente, la haya hecho quien la haya hecho).
      if (isDoctor && view === "pending") params.set("mine", "true");
      if (view === "expiring") params.set("expiringInDays", String(expiryDays));
      if (view === "history") {
        if (outcome !== "all") params.set("outcome", outcome);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      if (centerId) params.set("centerId", centerId);
      if (roomFilter) params.set("roomId", roomFilter);
      return apiFetch<RevisionList>(`/revisions?${params.toString()}`, { raw: true });
    },
  });

  const { data: stats } = useQuery<{ pending: number; expiringSoon: number; completedThisMonth: number; aptoThisMonth: number; aptitudeRate: number | null }>({
    queryKey: ["revisions-stats", centerId, roomFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (centerId) p.set("centerId", centerId);
      if (roomFilter) p.set("roomId", roomFilter);
      const qs = p.toString();
      return apiFetch(`/revisions/stats${qs ? `?${qs}` : ""}`);
    },
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  async function viewCertificate(id: string) {
    const res = await fetch(`/api/proxy/revisions/${id}/pdf`, { headers: authHeaders() });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="p-6 max-w-5xl">
      {avisarRow && <AvisarModal row={avisarRow} onClose={() => setAvisarRow(null)} />}
      {clientId && <ClientInfoModal customerId={clientId} onClose={() => setClientId(null)} />}
      {/* Header + search */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Revisiones médicas</h1>
          <p className="text-sm text-gray-500 mt-0.5">{isDoctor ? "Tus pendientes de cerrar e historial del paciente" : "Historial, pendientes y renovaciones"}</p>
        </div>
        <div className="relative w-72 max-w-[45%]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente o DNI"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Indicadores de gestión (clicables → cambian de vista). No aplican al médico. */}
      {!isDoctor && (() => {
        const mr = monthRange();
        const isMonthHistory = view === "history" && from === mr.from && to === mr.to;
        return (
          <div className="grid grid-cols-4 gap-3 mb-5">
            <KpiCard label="Pendientes" value={stats?.pending ?? "—"} icon={ClipboardList} tone="neutral"
              active={view === "pending"} onClick={() => setView("pending")} />
            <KpiCard label="Por caducar ≤ 30 días" value={stats?.expiringSoon ?? "—"} icon={AlarmClock} tone="red"
              active={view === "expiring"} onClick={() => { setView("expiring"); setExpiryDays(30); }} />
            <KpiCard label="Completadas este mes" value={stats?.completedThisMonth ?? "—"} icon={CircleCheck} tone="blue"
              active={isMonthHistory && outcome === "all"}
              onClick={() => { setView("history"); setOutcome("all"); setFrom(mr.from); setTo(mr.to); }} />
            <KpiCard label="Tasa de aptitud (mes)"
              value={stats ? (stats.aptitudeRate === null ? "—" : `${stats.aptitudeRate}%`) : "—"}
              sub={stats && stats.completedThisMonth > 0 ? `${stats.aptoThisMonth}/${stats.completedThisMonth}` : undefined}
              icon={Percent} tone="teal"
              active={isMonthHistory && outcome === "APTO"}
              onClick={() => { setView("history"); setOutcome("APTO"); setFrom(mr.from); setTo(mr.to); }} />
          </div>
        );
      })()}

      {/* View tabs (izq) · filtro de sala (der, misma posición que Reservas/Visitas) */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {views.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${view === v.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto"><RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={setRoomFilter} /></div>
      </div>

      {/* Contextual filters */}
      {view === "expiring" && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Caducan en:</span>
          {EXPIRY_WINDOWS.map((d) => (
            <button key={d} onClick={() => setExpiryDays(d)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${expiryDays === d ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
              {d === 365 ? "1 año" : `${d} días`}
            </button>
          ))}
          <span className="text-xs text-gray-400 ml-1">· incluye ya vencidas · orden por caducidad</span>
        </div>
      )}
      {view === "history" && (
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex gap-1">
            {HISTORY_OUTCOMES.map((o) => (
              <button key={o.key} onClick={() => setOutcome(o.key)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${outcome === o.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-gray-500">Desde</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-xs text-gray-500">hasta</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {(from || to) && (
              <button onClick={() => { setFrom(""); setTo(""); }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Limpiar</button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-2 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Producto</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Fecha cita</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Caducidad</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Estado</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                {view === "expiring" ? "Ninguna revisión caduca en ese plazo" : view === "pending" ? "No hay revisiones pendientes" : "Sin revisiones"}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <button onClick={() => setClientId(r.appointment.customer.id)} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 text-left">
                    <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="font-medium text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2">{r.appointment.customer.firstName} {r.appointment.customer.lastName}</span>
                  </button>
                </td>
                <td className="px-4 py-2 text-gray-600">{r.appointment.product.name}</td>
                <td className="px-4 py-2 text-gray-600">{fmt(r.appointment.scheduledAt)}</td>
                <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                  {fmt(r.expiryDate)}
                  {r.outcome === "APTO" && <ExpiryPill expiryDate={r.expiryDate} />}
                </td>
                <td className="px-4 py-2">{outcomeBadge(r.outcome)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {r.outcome === "APTO" && (
                      <>
                        {!isDoctor && (
                          <button onClick={() => setAvisarRow(r)}
                            title={r.avisoCount > 0 ? `${r.avisoCount} aviso${r.avisoCount === 1 ? "" : "s"} · último ${avisoAgo(r.lastAvisoAt)}` : "Avisar de renovación"}
                            className={`relative p-1.5 rounded-md transition-colors ${r.avisoCount > 0 ? "text-blue-600 bg-blue-50 hover:bg-blue-100" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"}`}>
                            <Bell className="w-4 h-4" />
                            {r.avisoCount > 1 && (
                              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-gray-200 border border-white text-gray-600 text-[9px] leading-[12px] text-center">{r.avisoCount}</span>
                            )}
                          </button>
                        )}
                        <button onClick={() => void viewCertificate(r.id)} title="Ver certificado (PDF)"
                          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                          <FileText className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {isClinical && (
                      <Link href={`/revisions/${r.id}`} title="Gestionar revisión"
                        className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors">
                        Gestionar
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
            <span>{rows.length} de {meta.total}{meta.pages > 1 ? ` · página ${meta.page} de ${meta.pages}` : ""}</span>
            {meta.pages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={meta.page <= 1}
                  className="px-2.5 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
                <button onClick={() => setPage((p) => Math.min(meta.pages, p + 1))} disabled={meta.page >= meta.pages}
                  className="px-2.5 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente →</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
