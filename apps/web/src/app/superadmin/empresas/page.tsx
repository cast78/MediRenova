"use client";

// Panel de proveedor (crm-planes P4): empresas, licencias, señales comerciales y
// peticiones "Quiero pasar a Pro". Solo SUPERADMIN.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, Inbox, Flame, Moon, Plus, Search, LogIn, Check, X, Loader2 } from "lucide-react";
import { apiFetch, ApiError, setActAsTenant } from "@/lib/api";
import { PLAN_LABEL, type PlanTier } from "@/lib/use-features";
import { PlanChip } from "@/components/plan-chip";

interface Row {
  id: string; name: string; slug: string; active: boolean; plan: PlanTier; effectivePlan: PlanTier;
  trialUntil: string | null; trialDaysLeft: number | null; maxCenters: number | null; timezone: string | null; createdAt: string;
  centersCount: number; usersCount: number; customersCount: number;
  appointments30d: number; noShows30d: number; lastActivityAt: string | null; openRequests: number;
  candidate: boolean; inactive: boolean;
}
interface Meta {
  total: number; byPlan: Record<PlanTier, number>; trials: number; trialsEndingSoon: number; openRequests: number;
  candidates: number; inactive: number; centers: number; thresholds: { noShows30d: number; appointments30d: number };
}
interface PlanRequest {
  id: string; tenantId: string; note: string | null; status: "OPEN" | "CLOSED"; createdAt: string; closedAt: string | null;
  tenant: { name: string; slug: string; plan: PlanTier }; byUser: { email: string; firstName: string; lastName: string } | null;
}

type Filter = "all" | "ESSENTIAL" | "PRO" | "trial" | "requests" | "candidates" | "inactive";

const CARD = "bg-white rounded-xl border border-gray-200 p-5";
const FIELD = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function fmt(iso: string | null): string { return iso ? new Date(iso).toLocaleDateString("es-ES") : "—"; }

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (Array.isArray(e) && e[0]?.message) return e[0].message;
    if (e && typeof e === "object") { const m = Object.values(e as Record<string, string[]>).flat().filter(Boolean); if (m.length) return m.join(" · "); }
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : "Error";
}

export default function EmpresasPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ data: Row[]; meta: Meta }>({
    queryKey: ["superadmin-tenants"],
    queryFn: () => apiFetch("/superadmin/tenants", { raw: true }),
  });
  const { data: requests } = useQuery<PlanRequest[]>({
    queryKey: ["superadmin-plan-requests"],
    queryFn: () => apiFetch<PlanRequest[]>("/superadmin/plan-requests?status=OPEN"),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const all = data?.data ?? [];
    const s = q.trim().toLowerCase();
    return all.filter((r) => {
      if (s && !`${r.name} ${r.slug}`.toLowerCase().includes(s)) return false;
      if (filter === "ESSENTIAL" || filter === "PRO") return r.effectivePlan === filter;
      if (filter === "trial") return r.trialDaysLeft != null;
      if (filter === "requests") return r.openRequests > 0;
      if (filter === "candidates") return r.candidate;
      if (filter === "inactive") return r.inactive;
      return true;
    });
  }, [data, filter, q]);
  const m = data?.meta;

  const closeRequest = useMutation({
    mutationFn: (id: string) => apiFetch(`/superadmin/plan-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status: "CLOSED" }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["superadmin-plan-requests"] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); },
  });

  function enterAs(id: string) { setActAsTenant(id); window.location.href = "/dashboard"; }

  const chip = (k: Filter, label: string, n?: number) => (
    <button key={k} type="button" onClick={() => setFilter(k)}
      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1 ${filter === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"}`}>
      {label}{n != null && <span className={`text-[10px] px-1.5 rounded-full ${filter === k ? "bg-white/20" : "bg-gray-100"}`}>{n}</span>}
    </button>
  );

  return (
    <div className="p-6 max-w-7xl space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-gray-400" /> Empresas</h1>
          <p className="text-sm text-gray-500">Licencias, actividad y señales comerciales de todas las clínicas.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Plus className="w-4 h-4" /> Nueva empresa</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
        <Kpi label="Empresas" value={m?.total ?? 0} sub={m ? `${m.byPlan.ESSENTIAL} Esencial · ${m.byPlan.PRO} Pro` : ""} cls="bg-white border-gray-200" />
        <Kpi label="Centros" value={m?.centers ?? 0} sub="contratados en total" cls="bg-white border-gray-200" />
        <Kpi label="En prueba" value={m?.trials ?? 0} sub={m && m.trialsEndingSoon > 0 ? `${m.trialsEndingSoon} vencen en ≤7 días` : "ninguna vence pronto"} cls="bg-amber-50 border-amber-200" icon={<Clock className="w-3.5 h-3.5 text-amber-600" />} />
        <Kpi label="Peticiones" value={m?.openRequests ?? 0} sub="quieren pasar a Pro" cls="bg-blue-50 border-blue-200" icon={<Inbox className="w-3.5 h-3.5 text-blue-600" />} />
        <Kpi label="Candidatas a Pro" value={m?.candidates ?? 0} sub={m ? `≥${m.thresholds.noShows30d} no-shows o ≥${m.thresholds.appointments30d} citas/mes` : ""} cls="bg-emerald-50 border-emerald-200" icon={<Flame className="w-3.5 h-3.5 text-emerald-600" />} />
        <Kpi label="Sin actividad" value={m?.inactive ?? 0} sub="sin citas en 30 días" cls="bg-gray-50 border-dashed border-gray-300" icon={<Moon className="w-3.5 h-3.5 text-gray-500" />} />
      </div>

      {/* Peticiones abiertas */}
      {requests && requests.length > 0 && (
        <section className={`${CARD} border-blue-200`}>
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3"><Inbox className="w-4 h-4 text-blue-600" /> Peticiones abiertas</h2>
          <div className="divide-y divide-gray-100">
            {requests.map((r) => (
              <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{r.tenant.name} <span className="text-xs text-gray-400">· {PLAN_LABEL[r.tenant.plan]} → Pro</span></p>
                  <p className="text-xs text-gray-500">{fmt(r.createdAt)}{r.byUser ? ` · ${r.byUser.firstName} ${r.byUser.lastName} (${r.byUser.email})` : ""}{r.note ? ` · ${r.note}` : ""}</p>
                </div>
                <Link href={`/superadmin/empresas/${r.tenantId}`} className="text-xs font-semibold text-blue-600 hover:underline">Gestionar →</Link>
                <button type="button" onClick={() => closeRequest.mutate(r.id)} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"><Check className="w-3.5 h-3.5" /> Cerrar</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {chip("all", "Todas", m?.total)}{chip("ESSENTIAL", "Esencial", m?.byPlan.ESSENTIAL)}{chip("PRO", "Pro", m?.byPlan.PRO)}{chip("trial", "En prueba", m?.trials)}{chip("requests", "Con petición", m?.openRequests)}{chip("candidates", "Candidatas a Pro", m?.candidates)}{chip("inactive", "Sin actividad", m?.inactive)}
        <label className="ml-auto inline-flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white"><Search className="w-3.5 h-3.5 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empresa…" className="text-sm focus:outline-none w-44" /></label>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              {["Empresa", "Plan", "Prueba", "Centros", "Usuarios", "Pacientes", "Citas/mes", "No-shows/mes", "Última cita", ""].map((h) => <th key={h} className="text-left font-semibold px-3 py-2.5 border-b border-gray-200 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">Sin empresas con este filtro.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className={`border-b border-gray-100 last:border-0 ${!r.active ? "opacity-60" : ""}`}>
                <td className="px-3 py-2.5">
                  <Link href={`/superadmin/empresas/${r.id}`} className="font-medium text-gray-900 hover:text-blue-700">{r.name}</Link>
                  <div className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">{r.slug}{!r.active && <span className="text-red-600 font-medium">· suspendida</span>}{r.candidate && <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold"><Flame className="w-3 h-3" /> candidata a Pro</span>}{r.openRequests > 0 && <span className="text-blue-700 font-semibold">· petición abierta</span>}</div>
                </td>
                <td className="px-3 py-2.5"><PlanChip plan={r.effectivePlan} /></td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.trialDaysLeft != null ? <span className={`text-xs font-semibold ${r.trialDaysLeft <= 7 ? "text-amber-700" : "text-gray-700"}`}>{r.trialDaysLeft} días</span> : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums">{r.centersCount}{r.maxCenters != null ? <span className="text-gray-400"> / {r.maxCenters}</span> : ""}</td>
                <td className="px-3 py-2.5 tabular-nums">{r.usersCount}</td>
                <td className="px-3 py-2.5 tabular-nums">{r.customersCount}</td>
                <td className="px-3 py-2.5 tabular-nums">{r.appointments30d}</td>
                <td className={`px-3 py-2.5 tabular-nums ${r.noShows30d >= (m?.thresholds.noShows30d ?? 5) ? "text-red-600 font-semibold" : ""}`}>{r.noShows30d}</td>
                <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.lastActivityAt ? fmt(r.lastActivityAt) : <span className="text-gray-300">nunca</span>}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><button type="button" onClick={() => enterAs(r.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"><LogIn className="w-3.5 h-3.5" /> Entrar como</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <NewTenantModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); void qc.invalidateQueries({ queryKey: ["admin-tenants"] }); }} />}
    </div>
  );
}

function Kpi({ label, value, sub, cls, icon }: { label: string; value: number; sub: string; cls: string; icon?: React.ReactNode }) {
  return (
    <div className={`border rounded-xl px-3.5 py-3 flex flex-col gap-0.5 ${cls}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 inline-flex items-center gap-1">{icon}{label}</span>
      <span className="text-2xl font-bold tabular-nums text-gray-900">{value}</span>
      <span className="text-[11px] text-gray-400">{sub}</span>
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
