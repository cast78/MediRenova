"use client";

// Panel de proveedor (crm-planes P4/P4b): centro de mando de empresas y licencias.
// KPIs que filtran, columna "Atención" con orden por atención necesaria, panel
// lateral con acciones rápidas y diálogo de confirmación de cambio de plan.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, Inbox, Flame, Moon, Plus, Search, LogIn, Check, X, Loader2, Sparkles } from "lucide-react";
import { apiFetch, ApiError, setActAsTenant } from "@/lib/api";
import { PLAN_LABEL, trialTone, type PlanTier } from "@/lib/use-features";
import { PlanChip } from "@/components/plan-chip";
import { PlanChangeDialog, type CatalogEntry } from "@/components/plan-change-dialog";
import { ConfirmDialog, type ConfirmSpec } from "@/components/confirm-dialog";

interface Row {
  id: string; name: string; slug: string; active: boolean; plan: PlanTier; effectivePlan: PlanTier;
  trialUntil: string | null; trialDaysLeft: number | null; maxCenters: number | null; timezone: string | null; createdAt: string;
  admin: { email: string; name: string } | null;
  centersCount: number; usersCount: number; customersCount: number;
  appointments30d: number; noShows30d: number; lastActivityAt: string | null; monthly: number[]; openRequests: number;
  candidate: boolean; inactive: boolean;
}
interface Meta {
  total: number; byPlan: Record<PlanTier, number>; trials: number; trialsEndingSoon: number; openRequests: number;
  candidates: number; inactive: number; centers: number; thresholds: { noShows30d: number; appointments30d: number };
  catalog: CatalogEntry[]; months: string[];
}
interface PlanRequest {
  id: string; tenantId: string; kind: "UPGRADE" | "TRIAL" | "CENTER"; note: string | null; status: "OPEN" | "APPROVED" | "REJECTED" | "CLOSED"; createdAt: string; closedAt: string | null;
  tenant: { name: string; slug: string; plan: PlanTier }; byUser: { email: string; firstName: string; lastName: string } | null;
}

type Filter = "all" | "ESSENTIAL" | "PRO" | "trial" | "requests" | "candidates" | "inactive";

const CARD = "bg-white rounded-xl border border-gray-200 p-5";
const FIELD = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmt(iso: string | null): string { return iso ? new Date(iso).toLocaleDateString("es-ES") : "—"; }
function monthLabel(ym: string): string { return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym; }

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (Array.isArray(e) && e[0]?.message) return e[0].message;
    if (e && typeof e === "object") { const m = Object.values(e as Record<string, string[]>).flat().filter(Boolean); if (m.length) return m.join(" · "); }
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : "Error";
}

// "Atención": señales que necesitan acción, ordenadas por prioridad. Una empresa
// puede tener varias a la vez (p. ej. sin actividad Y en prueba): se muestran todas,
// la primera como principal.
type Att = { key: "requests" | "trial" | "candidates" | "inactive" | "ok"; label: string; cls: string; rank: number };
function attentions(r: Row): Att[] {
  const out: Att[] = [];
  if (r.openRequests > 0) out.push({ key: "requests", label: "Petición abierta", cls: "bg-blue-100 text-blue-800 border-blue-300", rank: 0 });
  if (r.trialDaysLeft != null && r.trialDaysLeft <= 7) out.push({ key: "trial", label: `Prueba vence en ${r.trialDaysLeft} día${r.trialDaysLeft === 1 ? "" : "s"}`, cls: trialTone(r.trialDaysLeft).chip, rank: 1 });
  if (r.candidate) out.push({ key: "candidates", label: "Candidata a Pro", cls: "bg-emerald-100 text-emerald-800 border-emerald-300", rank: 2 });
  if (r.inactive) out.push({ key: "inactive", label: "Sin actividad 30 días", cls: "bg-gray-100 text-gray-600 border-gray-300 border-dashed", rank: 3 });
  if (r.trialDaysLeft != null && r.trialDaysLeft > 7) out.push({ key: "trial", label: `En prueba · ${r.trialDaysLeft} días`, cls: trialTone(r.trialDaysLeft).chip, rank: 4 });
  if (out.length === 0) out.push({ key: "ok", label: "Al día", cls: "bg-white text-gray-400 border-gray-200", rank: 5 });
  return out.sort((a, b) => a.rank - b.rank);
}
function attention(r: Row): Att { return attentions(r)[0]!; }
const Chip = ({ a, small }: { a: Att; small?: boolean }) => <span className={`inline-flex font-semibold rounded-full border whitespace-nowrap ${small ? "text-[10px] px-1.5 py-0" : "text-[11px] px-2 py-0.5"} ${a.cls}`}>{a.label}</span>;

function attentionDetail(r: Row, m: Meta | undefined): string {
  const a = attention(r);
  if (a.key === "requests") return `Ha pedido pasar a Pro${r.admin ? ` · ${r.admin.name} (admin)` : ""}. ${r.appointments30d} citas y ${r.noShows30d} no-shows en 30 días.`;
  if (a.key === "trial") return `Prueba Pro hasta el ${fmt(r.trialUntil)}. Al vencer vuelve a ${PLAN_LABEL[r.plan]}.`;
  if (a.key === "candidates") return `${r.noShows30d} no-shows y ${r.appointments30d} citas en 30 días (umbral: ≥${m?.thresholds.noShows30d ?? 5} no-shows o ≥${m?.thresholds.appointments30d ?? 80} citas). Argumento: recuperación automática.`;
  if (a.key === "inactive") return r.lastActivityAt ? `Sin citas desde el ${fmt(r.lastActivityAt)}. Riesgo de baja: conviene llamar.` : "Nunca ha creado una cita. ¿Necesita ayuda para arrancar?";
  return "Todo en orden.";
}

export default function EmpresasPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ data: Row[]; meta: Meta }>({ queryKey: ["superadmin-tenants"], queryFn: () => apiFetch("/superadmin/tenants", { raw: true }) });
  const { data: requests } = useQuery<PlanRequest[]>({ queryKey: ["superadmin-plan-requests"], queryFn: () => apiFetch<PlanRequest[]>("/superadmin/plan-requests?status=OPEN") });
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<{ row: Row; to: PlanTier } | null>(null);
  // Notificación flotante de las acciones (éxito en verde, error en rojo); se va sola.
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "error" } | null>(null);
  const notify = (msg: string, kind: "ok" | "error" = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), kind === "ok" ? 3500 : 5000); };
  const setFlash = (msg: string | null) => { if (msg) notify(msg); };
  // Resalte breve de lo que acaba de cambiar en el panel lateral (plan / prueba).
  const [pulse, setPulse] = useState<"plan" | "trial" | null>(null);
  const highlight = (what: "plan" | "trial") => { setPulse(what); setTimeout(() => setPulse(null), 1200); };
  // Filtro por URL (?filter=requests desde el menú "Peticiones"): reactivo a la
  // navegación entre "Empresas" y "Peticiones" sin remontar la página.
  const sp = useSearchParams();
  const urlFilter = sp.get("filter");
  useEffect(() => { setFilter(urlFilter === "requests" ? "requests" : "all"); }, [urlFilter]);

  const m = data?.meta;
  const rows = useMemo(() => {
    const all = data?.data ?? [];
    const s = q.trim().toLowerCase();
    return all
      .filter((r) => {
        if (s && !`${r.name} ${r.slug} ${r.admin?.email ?? ""}`.toLowerCase().includes(s)) return false;
        if (filter === "ESSENTIAL" || filter === "PRO") return r.effectivePlan === filter;
        if (filter === "trial") return r.trialDaysLeft != null;
        if (filter === "requests") return r.openRequests > 0;
        if (filter === "candidates") return r.candidate;
        if (filter === "inactive") return r.inactive;
        return true;
      })
      .sort((a, b) => attention(a).rank - attention(b).rank || a.name.localeCompare(b.name));
  }, [data, filter, q]);
  const sel = (data?.data ?? []).find((r) => r.id === selId) ?? rows[0] ?? null;

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown>; msg: string }) => apiFetch(`/superadmin/tenants/${v.id}`, { method: "PATCH", body: JSON.stringify(v.body) }).then(() => v.msg),
    onSuccess: (msg) => { notify(msg); highlight("trial"); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenant"] }); },
    onError: (e: unknown) => notify(errorMessage(e), "error"),
  });
  // Decidir una petición: aprobar la prueba (activa 14 días), rechazar (con nota) o cerrar.
  const decide = useMutation({
    mutationFn: (v: { id: string; status: "APPROVED" | "REJECTED" | "CLOSED"; note?: string | undefined; msg: string }) =>
      apiFetch(`/superadmin/plan-requests/${v.id}`, { method: "PATCH", body: JSON.stringify({ status: v.status, note: v.note, trialDays: 14 }) }).then(() => v.msg),
    onSuccess: (msg) => { notify(msg); void qc.invalidateQueries({ queryKey: ["superadmin-plan-requests"] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenant"] }); },
    onError: (e: unknown) => notify(errorMessage(e), "error"),
  });
  const KIND_LABEL = { TRIAL: "la prueba Pro de 14 días", UPGRADE: "pasar a Pro", CENTER: "un centro adicional" } as const;
  function reject(r: PlanRequest) {
    setConfirm({
      title: "Rechazar la petición",
      text: <>Vas a <b>rechazar</b> la petición de <b>{r.tenant.name}</b> ({KIND_LABEL[r.kind]}). La clínica verá el motivo en su pantalla. ¿Estás seguro?</>,
      confirmLabel: "Rechazar petición",
      tone: "red",
      noteLabel: "Motivo del rechazo (lo verá la clínica)",
      noteRequired: true,
      onConfirm: (note) => decide.mutateAsync({ id: r.id, status: "REJECTED", note, msg: `Petición de ${r.tenant.name} rechazada` }).then(() => undefined),
    });
  }
  function approve(r: PlanRequest) {
    const isTrial = r.kind === "TRIAL";
    setConfirm({
      title: isTrial ? "Aprobar la prueba Pro" : "Ampliar el límite de centros",
      text: isTrial
        ? <>Vas a aprobar la <b>prueba Pro de 14 días</b> para <b>{r.tenant.name}</b>: se activa ahora mismo y tendrá abiertos todos los módulos Pro hasta que venza. ¿Estás seguro?</>
        : <>Vas a <b>ampliar en 1</b> el límite de centros contratados de <b>{r.tenant.name}</b>. Podrá crear un centro más desde ya. ¿Estás seguro?</>,
      confirmLabel: isTrial ? "Aprobar prueba (14 d)" : "Ampliar límite (+1 centro)",
      tone: "green",
      onConfirm: () => decide.mutateAsync({ id: r.id, status: "APPROVED", msg: isTrial ? `Prueba Pro de 14 días aprobada para ${r.tenant.name}` : `Límite de centros de ${r.tenant.name} ampliado en 1` }).then(() => undefined),
    });
  }
  function closeReq(r: PlanRequest) {
    setConfirm({
      title: "Cerrar la petición",
      text: <>Vas a <b>cerrar</b> la petición de <b>{r.tenant.name}</b> ({KIND_LABEL[r.kind]}) sin cambiar su plan (p. ej. porque la has atendido por otra vía). ¿Estás seguro?</>,
      confirmLabel: "Cerrar petición",
      tone: "blue",
      onConfirm: () => decide.mutateAsync({ id: r.id, status: "CLOSED", msg: `Petición de ${r.tenant.name} cerrada` }).then(() => undefined),
    });
  }
  // Confirmación previa de cada acción rápida (texto según la acción).
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  // Dar o ampliar la prueba: si ya hay una vigente, los días se suman a su fin.
  function trial(r: Row, days: number) {
    const base = r.trialDaysLeft != null && r.trialUntil ? new Date(r.trialUntil).getTime() : Date.now();
    const until = new Date(base + days * 86_400_000);
    const extend = r.trialDaysLeft != null;
    const untilTxt = until.toLocaleDateString("es-ES");
    setConfirm({
      title: extend ? "Ampliar la prueba Pro" : "Activar una prueba Pro",
      text: extend
        ? <>Vas a <b>ampliar {days} días</b> la prueba Pro de <b>{r.name}</b>: pasará a vencer el <b>{untilTxt}</b>. ¿Estás seguro?</>
        : <>Vas a activar una <b>prueba Pro de {days} días</b> para <b>{r.name}</b> (hasta el <b>{untilTxt}</b>). Mientras dure, tendrá abiertos todos los módulos Pro. ¿Estás seguro?</>,
      confirmLabel: extend ? `Ampliar ${days} días` : `Activar prueba de ${days} días`,
      tone: "amber",
      onConfirm: () => patch.mutateAsync({ id: r.id, body: { trialUntil: until.toISOString(), reason: extend ? `Prueba Pro ampliada ${days} días` : `Prueba Pro de ${days} días` }, msg: `${extend ? "Prueba ampliada" : "Prueba Pro activada"} hasta el ${untilTxt}` }).then(() => undefined),
    });
  }
  function removeTrial(r: Row) {
    setConfirm({
      title: "Retirar la prueba Pro",
      text: <>Vas a <b>retirar la prueba Pro</b> de <b>{r.name}</b>: desde ahora volverá al plan <b>{PLAN_LABEL[r.plan]}</b> y los módulos Pro quedarán bloqueados (sus datos se conservan). ¿Estás seguro?</>,
      confirmLabel: "Retirar prueba",
      tone: "red",
      onConfirm: () => patch.mutateAsync({ id: r.id, body: { trialUntil: null, reason: "Prueba retirada" }, msg: `Prueba retirada: ${r.name} vuelve a ${PLAN_LABEL[r.plan]}` }).then(() => undefined),
    });
  }
  function enterAs(id: string) { setActAsTenant(id); window.location.href = "/dashboard"; }

  const kpi = (k: Filter, label: string, value: number | undefined, sub: string, icon: React.ReactNode, on: string) => (
    <button key={k} type="button" onClick={() => setFilter(filter === k ? "all" : k)}
      className={`text-left border rounded-xl px-3.5 py-3 flex flex-col gap-0.5 transition-colors ${filter === k ? on : "bg-white border-gray-200 hover:border-blue-200"}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 inline-flex items-center gap-1">{icon}{label}</span>
      <span className="text-2xl font-bold tabular-nums text-gray-900">{value ?? 0}</span>
      <span className="text-[11px] text-gray-500">{sub}</span>
    </button>
  );

  return (
    <div className="p-6 max-w-[1400px] space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-gray-400" /> Empresas</h1>
          <p className="text-sm text-gray-500">Licencias, actividad y qué necesita tu atención hoy.</p>
        </div>
        <label className="ml-auto inline-flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-2 bg-white"><Search className="w-3.5 h-3.5 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Empresa, slug o email del admin…" className="text-sm focus:outline-none w-60" /></label>
        <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Plus className="w-4 h-4" /> Nueva empresa</button>
      </div>

      {/* KPIs = filtros */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
        {kpi("all", "Empresas", m?.total, m ? `${m.byPlan.ESSENTIAL} Esencial · ${m.byPlan.PRO} Pro` : "", null, "bg-blue-600 border-blue-600 text-white [&_span]:text-white")}
        {kpi("requests", "Peticiones", m?.openRequests, "quieren pasar a Pro", <Inbox className="w-3.5 h-3.5 text-blue-600" />, "bg-blue-100 border-blue-300")}
        {kpi("trial", "En prueba", m?.trials, m && m.trialsEndingSoon > 0 ? `${m.trialsEndingSoon} vencen en ≤7 días` : "ninguna vence pronto", <Clock className="w-3.5 h-3.5 text-amber-600" />, "bg-amber-100 border-amber-300")}
        {kpi("candidates", "Candidatas a Pro", m?.candidates, m ? `≥${m.thresholds.noShows30d} no-shows o ≥${m.thresholds.appointments30d} citas/mes` : "", <Flame className="w-3.5 h-3.5 text-emerald-600" />, "bg-emerald-100 border-emerald-300")}
        {kpi("inactive", "Sin actividad", m?.inactive, "30 días sin citas", <Moon className="w-3.5 h-3.5 text-gray-500" />, "bg-gray-200 border-gray-400")}
        <div className="border rounded-xl px-3.5 py-3 flex flex-col gap-0.5 bg-white border-gray-200">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Centros</span>
          <span className="text-2xl font-bold tabular-nums text-gray-900">{m?.centers ?? 0}</span>
          <span className="text-[11px] text-gray-500">contratados en total</span>
        </div>
      </div>

      {/* Notificación flotante de acciones */}
      {toast && (
        <div role="status" className={`fixed top-4 right-4 z-[60] max-w-sm shadow-lg rounded-xl border px-4 py-3 text-sm flex items-start gap-2.5 ${toast.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-red-50 border-red-200 text-red-900"}`}>
          {toast.kind === "ok" ? <Check className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" /> : <X className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />}
          <span className="flex-1">{toast.msg}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Cerrar" className="text-current opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Peticiones abiertas (cuando el filtro es Peticiones o hay alguna y no se filtra otra cosa) */}
      {requests && requests.length > 0 && (filter === "requests" || filter === "all") && (
        <section className={`${CARD} border-blue-200`}>
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1"><Inbox className="w-4 h-4 text-blue-600" /> Peticiones abiertas</h2>
          <p className="text-xs text-gray-500 mb-3">Nada se activa sin tu autorización: aprueba la prueba (14 días), pasa a Pro o rechaza con un motivo que verá la clínica.</p>
          <div className="divide-y divide-gray-100">
            {requests.map((r) => (
              <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${r.kind === "TRIAL" ? "bg-amber-100 text-amber-800 border-amber-300" : r.kind === "CENTER" ? "bg-violet-100 text-violet-800 border-violet-300" : "bg-blue-100 text-blue-800 border-blue-300"}`}>{r.kind === "TRIAL" ? "Prueba 14 días" : r.kind === "CENTER" ? "Centro adicional" : "Pasar a Pro"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{r.tenant.name} <span className="text-xs text-gray-400">· {PLAN_LABEL[r.tenant.plan]}{r.kind === "UPGRADE" ? " → Pro" : ""}</span></p>
                  <p className="text-xs text-gray-500">{fmt(r.createdAt)}{r.byUser ? ` · ${r.byUser.firstName} ${r.byUser.lastName} (${r.byUser.email})` : ""}{r.note ? ` · ${r.note}` : ""}</p>
                </div>
                {r.kind === "TRIAL" ? (
                  <button type="button" onClick={() => approve(r)} disabled={decide.isPending} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Aprobar prueba (14 d)</button>
                ) : r.kind === "CENTER" ? (
                  <button type="button" onClick={() => approve(r)} disabled={decide.isPending} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Ampliar límite (+1 centro)</button>
                ) : (
                  <button type="button" onClick={() => { const row = data?.data.find((x) => x.id === r.tenantId); if (row) setDialog({ row, to: "PRO" }); }} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Sparkles className="w-3.5 h-3.5" /> Pasar a Pro</button>
                )}
                <button type="button" onClick={() => reject(r)} disabled={decide.isPending} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"><X className="w-3.5 h-3.5" /> Rechazar</button>
                {r.kind === "UPGRADE" && <button type="button" onClick={() => closeReq(r)} disabled={decide.isPending} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">Cerrar</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-4 items-start flex-wrap">
        {/* Lista */}
        <section className="flex-[999_1_600px] min-w-0 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
            <span>Mostrando <b className="text-gray-900">{rows.length}</b> de {m?.total ?? 0} · ordenadas por <b className="text-gray-900">atención necesaria</b></span>
            {filter !== "all" && <button type="button" onClick={() => setFilter("all")} className="ml-auto text-blue-600 font-medium hover:underline">Quitar filtro ×</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                  {["Empresa", "Atención", "Plan", "Centros", "Citas/mes", "No-shows", "Última cita", ""].map((h) => <th key={h} className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {isLoading ? <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>
                : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                    {(data?.data.length ?? 0) === 0 ? <>Aún no hay empresas. <button type="button" onClick={() => setCreating(true)} className="text-blue-600 font-semibold hover:underline">Crea la primera</button>.</>
                      : filter === "requests" ? "No hay peticiones abiertas ahora mismo. Cuando una clínica pulse «Quiero pasar a Pro», aparecerá aquí y en el badge del menú."
                      : "Ninguna empresa con este filtro."}
                  </td></tr>
                ) : rows.map((r) => {
                  const a = attention(r);
                  const active = sel?.id === r.id;
                  return (
                    <tr key={r.id} onClick={() => setSelId(r.id)} className={`cursor-pointer border-b border-gray-100 last:border-0 ${active ? "bg-blue-50 shadow-[inset_3px_0_0_#2563eb]" : "hover:bg-gray-50"} ${!r.active ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-[11px] font-bold shrink-0">{r.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                          <div className="min-w-0"><div className="font-semibold text-gray-900 truncate">{r.name}</div><div className="text-[11px] text-gray-400">{r.slug}{!r.active ? " · suspendida" : ""}</div></div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 items-start">
                          <Chip a={a} />
                          {attentions(r).slice(1).map((s) => <Chip key={s.key + s.label} a={s} small />)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><PlanChip plan={r.effectivePlan} /></td>
                      <td className="px-3 py-2.5 tabular-nums">{r.centersCount}{r.maxCenters != null ? <span className="text-gray-400"> / {r.maxCenters}</span> : ""}</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.appointments30d}</td>
                      <td className={`px-3 py-2.5 tabular-nums ${r.noShows30d >= (m?.thresholds.noShows30d ?? 5) ? "text-red-600 font-semibold" : ""}`}>{r.noShows30d}</td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.lastActivityAt ? fmt(r.lastActivityAt) : <span className="text-gray-300">nunca</span>}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap"><Link href={`/superadmin/empresas/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-semibold text-blue-600 hover:underline">Ficha →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel lateral */}
        {sel && (
          <aside className="flex-[1_1_320px] max-w-[360px] min-w-0 bg-white border border-gray-200 rounded-xl p-4 space-y-4 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-xs font-bold shrink-0">{sel.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-gray-900 truncate">{sel.name}</div>
                <div className="text-xs text-gray-500">{sel.slug} · {sel.centersCount} centro{sel.centersCount === 1 ? "" : "s"} · {sel.usersCount} usuario{sel.usersCount === 1 ? "" : "s"}</div>
              </div>
              <div className={`flex flex-col items-end gap-1 rounded-lg transition-shadow ${pulse === "plan" ? "ring-2 ring-emerald-400 ring-offset-2" : ""}`}>
                <PlanChip plan={sel.effectivePlan} />
                {sel.trialDaysLeft != null && <span className={`text-[10px] font-semibold border rounded-full px-1.5 py-0 whitespace-nowrap transition-shadow ${trialTone(sel.trialDaysLeft).chip} ${pulse === "trial" ? "ring-2 ring-emerald-400 ring-offset-1" : ""}`}>Prueba · {sel.trialDaysLeft} d</span>}
              </div>
            </div>
            <div className="space-y-1.5 text-[12.5px] text-gray-700">
              <div className="flex flex-wrap gap-1">{attentions(sel).map((s) => <Chip key={s.key + s.label} a={s} />)}</div>
              <p>{attentionDetail(sel, m)}</p>
            </div>

            <div>
              <div className="flex items-baseline justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Citas por mes</span><span className="text-[11px] text-gray-400">últimos 6 meses</span></div>
              <div className="flex items-end gap-1.5 h-14 mt-2">
                {sel.monthly.map((v, i) => { const max = Math.max(...sel.monthly, 1); return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                    <div className={`w-full rounded-t ${i === 5 ? "bg-blue-600" : "bg-blue-200"}`} style={{ height: `${Math.max(3, Math.round((v / max) * 40))}px` }} title={`${v} citas`} />
                    <span className="text-[10px] text-gray-400">{m?.months[i] ? monthLabel(m.months[i]!) : ""}</span>
                  </div>); })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Acciones rápidas</span>
              {sel.trialDaysLeft != null ? (
                <div className={`rounded-lg border px-2.5 py-2 text-xs flex items-center gap-1.5 flex-wrap transition-shadow ${trialTone(sel.trialDaysLeft).chip} ${pulse === "trial" ? "ring-2 ring-emerald-400" : ""}`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span className="font-semibold">Prueba Pro hasta el {fmt(sel.trialUntil)} · {sel.trialDaysLeft} días</span>
                  <span className="ml-auto inline-flex gap-1">
                    {[14, 30].map((d) => <button key={d} type="button" onClick={() => trial(sel, d)} disabled={patch.isPending} className="px-1.5 py-0.5 rounded border border-current/30 bg-white/70 font-semibold hover:bg-white disabled:opacity-50">+{d}</button>)}
                    <button type="button" onClick={() => removeTrial(sel)} disabled={patch.isPending} className="px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 disabled:opacity-50">Quitar</button>
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {[14, 30, 60].map((d) => <button key={d} type="button" onClick={() => trial(sel, d)} disabled={patch.isPending} className="text-xs font-semibold px-2 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Prueba {d} d</button>)}
                </div>
              )}
              {sel.plan === "PRO"
                ? <button type="button" onClick={() => setDialog({ row: sel, to: "ESSENTIAL" })} className="w-full text-sm font-semibold px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100">Cambiar a Esencial…</button>
                : <button type="button" onClick={() => setDialog({ row: sel, to: "PRO" })} className="w-full text-sm font-semibold px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 inline-flex items-center justify-center gap-1.5"><Sparkles className="w-4 h-4" /> Pasar a Pro…</button>}
              <button type="button" onClick={() => enterAs(sel.id)} className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><LogIn className="w-4 h-4" /> Entrar como esta empresa</button>
              <Link href={`/superadmin/empresas/${sel.id}`} className="block text-center text-[12.5px] font-semibold text-blue-600 hover:underline py-1">Ver ficha completa →</Link>
            </div>
          </aside>
        )}
      </div>

      {creating && <NewTenantModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); }} />}
      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
      {dialog && m && <PlanChangeDialog tenant={{ id: dialog.row.id, name: dialog.row.name, plan: dialog.row.plan, centersCount: dialog.row.centersCount, openRequests: dialog.row.openRequests, adminName: dialog.row.admin?.name ?? null }} to={dialog.to} catalog={m.catalog} onClose={() => setDialog(null)} onDone={() => { setSelId(dialog.row.id); setFlash(`${dialog.row.name} ahora es ${PLAN_LABEL[dialog.to]}${dialog.to === "PRO" && dialog.row.openRequests > 0 ? " · petición cerrada" : ""}`); highlight("plan"); }} />}
    </div>
  );
}

function NewTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", slug: "", timezone: "Europe/Madrid", plan: "ESSENTIAL" as PlanTier, trialDays: "", maxCenters: "", email: "", firstName: "", lastName: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: () => apiFetch("/superadmin/tenants", { method: "POST", body: JSON.stringify({
      name: f.name.trim(), slug: f.slug.trim(), timezone: f.timezone, plan: f.plan,
      trialUntil: f.trialDays ? new Date(Date.now() + Number(f.trialDays) * 86_400_000).toISOString() : null,
      maxCenters: f.maxCenters ? Number(f.maxCenters) : null,
      admin: { email: f.email.trim(), firstName: f.firstName.trim(), lastName: f.lastName.trim(), password: f.password },
    }) }),
    onSuccess: onCreated,
    onError: (e: unknown) => setError(errorMessage(e)),
  });
  const slugAuto = () => setF((s) => ({ ...s, slug: s.slug || s.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") }));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Nueva empresa</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2"><span className="text-xs font-medium text-gray-600">Nombre</span><input value={f.name} onChange={set("name")} onBlur={slugAuto} required className={FIELD} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Slug (URL del portal)</span><input value={f.slug} onChange={set("slug")} required pattern="[a-z0-9-]+" className={FIELD} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Zona horaria</span><select value={f.timezone} onChange={set("timezone")} className={FIELD}><option>Europe/Madrid</option><option>Atlantic/Canary</option></select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Plan</span><select value={f.plan} onChange={set("plan")} className={FIELD}><option value="ESSENTIAL">Esencial</option><option value="PRO">Pro</option></select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Prueba Pro (días, opcional)</span><input type="number" min={1} max={365} value={f.trialDays} onChange={set("trialDays")} placeholder="30" className={FIELD} /></label>
            <label className="block col-span-2"><span className="text-xs font-medium text-gray-600">Límite de centros (vacío = sin límite)</span><input type="number" min={1} value={f.maxCenters} onChange={set("maxCenters")} className={FIELD} /></label>
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">Administrador inicial</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Nombre</span><input value={f.firstName} onChange={set("firstName")} required className={FIELD} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Apellidos</span><input value={f.lastName} onChange={set("lastName")} required className={FIELD} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Email</span><input type="email" value={f.email} onChange={set("email")} required className={FIELD} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Contraseña temporal</span><input type="password" value={f.password} onChange={set("password")} required minLength={8} className={FIELD} /></label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={create.isPending} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">{create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Crear empresa</button>
          </div>
        </form>
      </div>
    </div>
  );
}
