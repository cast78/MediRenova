"use client";

// Ficha de empresa del panel de proveedor (crm-planes P4): plan, prueba,
// excepciones por función, límite de centros, activar/suspender, auditoría,
// peticiones y "Entrar como esta empresa".
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogIn, Save, Loader2, Check, Lock, Sparkles, History, Inbox, Building2 } from "lucide-react";
import { apiFetch, ApiError, setActAsTenant } from "@/lib/api";
import { PLAN_LABEL, type PlanTier, type FeatureKey } from "@/lib/use-features";
import { PlanChip } from "@/components/plan-chip";

interface Detail {
  id: string; name: string; slug: string; active: boolean; plan: PlanTier; effectivePlan: PlanTier;
  trialUntil: string | null; trialDaysLeft: number | null; featureOverrides: { add?: FeatureKey[]; remove?: FeatureKey[] } | null; maxCenters: number | null;
  timezone: string | null; createdAt: string; features: FeatureKey[];
  catalog: { key: FeatureKey; label: string; min: PlanTier; requires: FeatureKey[] }[];
  usersCount: number; customersCount: number;
  centers: { id: string; name: string; city: string | null; active: boolean }[];
  history: { id: string; action: string; meta: Record<string, unknown> | null; createdAt: string; user: { email: string; firstName: string; lastName: string } | null }[];
  requests: { id: string; status: "OPEN" | "CLOSED"; note: string | null; createdAt: string; closedAt: string | null }[];
}

const CARD = "bg-white rounded-xl border border-gray-200 p-5";
const FIELD = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (Array.isArray(e) && e[0]?.message) return e.map((x: { message?: string }) => x.message).filter(Boolean).join(" · ");
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : "Error";
}

export default function EmpresaPage() {
  const params = useParams();
  const id = String((params as { id?: string }).id ?? "");
  const qc = useQueryClient();
  const { data: t, isLoading } = useQuery<Detail>({ queryKey: ["superadmin-tenant", id], queryFn: () => apiFetch<Detail>(`/superadmin/tenants/${id}`) });

  const [form, setForm] = useState<{ plan: PlanTier; trialUntil: string; maxCenters: string; active: boolean; add: FeatureKey[]; remove: FeatureKey[]; reason: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (t && !form) setForm({ plan: t.plan, trialUntil: toDateInput(t.trialUntil), maxCenters: t.maxCenters != null ? String(t.maxCenters) : "", active: t.active, add: t.featureOverrides?.add ?? [], remove: t.featureOverrides?.remove ?? [], reason: "" });
  }, [t, form]);

  const save = useMutation({
    mutationFn: () => apiFetch(`/superadmin/tenants/${id}`, { method: "PATCH", body: JSON.stringify({
      plan: form!.plan,
      trialUntil: form!.trialUntil ? new Date(`${form!.trialUntil}T23:59:59`).toISOString() : null,
      maxCenters: form!.maxCenters ? Number(form!.maxCenters) : null,
      active: form!.active,
      featureOverrides: form!.add.length || form!.remove.length ? { add: form!.add, remove: form!.remove } : null,
      reason: form!.reason || undefined,
    }) }),
    onSuccess: () => { setMsg("Cambios guardados"); setError(null); setForm(null); setTimeout(() => setMsg(null), 2500); void qc.invalidateQueries({ queryKey: ["superadmin-tenant", id] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); },
    onError: (e: unknown) => setError(errorMessage(e)),
  });
  const closeReq = useMutation({
    mutationFn: (rid: string) => apiFetch(`/superadmin/plan-requests/${rid}`, { method: "PATCH", body: JSON.stringify({ status: "CLOSED" }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["superadmin-tenant", id] }); void qc.invalidateQueries({ queryKey: ["superadmin-plan-requests"] }); },
  });

  if (isLoading || !t || !form) return <div className="p-6 text-sm text-gray-400">Cargando…</div>;

  // Qué tendría la empresa con el formulario actual (sin guardar): plan efectivo + excepciones.
  const trialActive = !!form.trialUntil && new Date(`${form.trialUntil}T23:59:59`) > new Date();
  const effective: PlanTier = trialActive ? "PRO" : form.plan;
  const toggle = (list: "add" | "remove", k: FeatureKey) => setForm((f) => f && ({ ...f, [list]: f[list].includes(k) ? f[list].filter((x) => x !== k) : [...f[list], k], ...(list === "add" ? { remove: f.remove.filter((x) => x !== k) } : { add: f.add.filter((x) => x !== k) }) }));

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/superadmin/empresas" className="text-gray-400 hover:text-gray-600 text-sm inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Empresas</Link>
        <h1 className="text-xl font-semibold text-gray-900">{t.name}</h1>
        <PlanChip plan={t.effectivePlan} />
        {t.trialDaysLeft != null && <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Prueba · {t.trialDaysLeft} días</span>}
        {!t.active && <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Suspendida</span>}
        <button type="button" onClick={() => { setActAsTenant(t.id); window.location.href = "/dashboard"; }} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><LogIn className="w-4 h-4" /> Entrar como esta empresa</button>
      </div>
      <p className="text-sm text-gray-500">{t.slug} · {t.timezone ?? "—"} · {t.usersCount} usuario{t.usersCount === 1 ? "" : "s"} · {t.customersCount} paciente{t.customersCount === 1 ? "" : "s"} · alta {fmt(t.createdAt).slice(0, 10)}</p>

      <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
        {/* Licencia */}
        <section className={`${CARD} space-y-4`}>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-500" /> Licencia</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Plan contratado</span>
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as PlanTier })} className={FIELD}><option value="ESSENTIAL">Esencial</option><option value="PRO">Pro</option></select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Prueba Pro hasta</span>
              <input type="date" value={form.trialUntil} onChange={(e) => setForm({ ...form, trialUntil: e.target.value })} className={FIELD} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Límite de centros</span>
              <input type="number" min={1} value={form.maxCenters} onChange={(e) => setForm({ ...form, maxCenters: e.target.value })} placeholder="sin límite" className={FIELD} /></label>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-gray-500">Plan efectivo con estos valores:</span><PlanChip plan={effective} />
            {trialActive && form.plan === "ESSENTIAL" && <span className="text-xs text-gray-400">(vuelve a Esencial al vencer la prueba)</span>}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Funciones (excepciones por empresa)</p>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {t.catalog.map((c) => {
                const base = c.min === "ESSENTIAL" || effective === "PRO";
                const added = form.add.includes(c.key), removed = form.remove.includes(c.key);
                const on = (base || added) && !removed;
                return (
                  <div key={c.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {on ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <Lock className="w-4 h-4 text-gray-300 shrink-0" />}
                    <span className={`flex-1 ${on ? "text-gray-800" : "text-gray-400"}`}>{c.label} <span className="text-[10px] text-gray-400 uppercase">{c.min === "PRO" ? "Pro" : "Esencial"}</span>{c.requires.length > 0 && <span className="text-[10px] text-gray-300"> · requiere {c.requires.join(", ")}</span>}</span>
                    {!base && <button type="button" onClick={() => toggle("add", c.key)} className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${added ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "text-gray-500 border-gray-200 hover:bg-gray-50"}`}>{added ? "Activada" : "Activar"}</button>}
                    {base && <button type="button" onClick={() => toggle("remove", c.key)} className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${removed ? "bg-red-50 text-red-700 border-red-200" : "text-gray-500 border-gray-200 hover:bg-gray-50"}`}>{removed ? "Quitada" : "Quitar"}</button>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
            <label className="block"><span className="text-xs font-medium text-gray-600">Motivo del cambio (queda en la auditoría)</span><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="p. ej. contrato firmado 10/10" className={FIELD} /></label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 pb-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-blue-600" /> Empresa activa</label>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar</button>
            {msg && <span className="text-sm text-emerald-700 inline-flex items-center gap-1"><Check className="w-4 h-4" /> {msg}</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </section>

        <div className="space-y-5">
          <section className={CARD}>
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-gray-400" /> Centros ({t.centers.filter((c) => c.active).length}{t.maxCenters != null ? ` / ${t.maxCenters}` : ""})</h2>
            {t.centers.length === 0 ? <p className="text-sm text-gray-400">Sin centros.</p> : <ul className="text-sm text-gray-700 space-y-1">{t.centers.map((c) => <li key={c.id} className={c.active ? "" : "text-gray-400 line-through"}>{c.name}{c.city ? <span className="text-gray-400"> · {c.city}</span> : null}</li>)}</ul>}
          </section>

          <section className={CARD}>
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2"><Inbox className="w-4 h-4 text-blue-500" /> Peticiones</h2>
            {t.requests.length === 0 ? <p className="text-sm text-gray-400">Ninguna.</p> : (
              <ul className="text-sm space-y-2">{t.requests.map((r) => (
                <li key={r.id} className="flex items-start gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${r.status === "OPEN" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{r.status === "OPEN" ? "abierta" : "cerrada"}</span>
                  <span className="flex-1 text-gray-700">{fmt(r.createdAt)}{r.note ? ` · ${r.note}` : ""}</span>
                  {r.status === "OPEN" && <button type="button" onClick={() => closeReq.mutate(r.id)} className="text-xs text-gray-500 hover:text-gray-800">Cerrar</button>}
                </li>))}</ul>
            )}
          </section>

          <section className={CARD}>
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2"><History className="w-4 h-4 text-gray-400" /> Historial de licencia</h2>
            {t.history.length === 0 ? <p className="text-sm text-gray-400">Sin cambios registrados.</p> : (
              <ul className="text-xs space-y-2">{t.history.map((h) => {
                const m = (h.meta ?? {}) as { before?: { plan?: string; trialUntil?: string | null }; after?: { plan?: string; trialUntil?: string | null }; plan?: string; reason?: string | null };
                const line = h.action === "CREATE" ? `Alta en ${PLAN_LABEL[(m.plan as PlanTier) ?? "PRO"]}` : m.before && m.after ? `${PLAN_LABEL[(m.before.plan as PlanTier) ?? "PRO"]} → ${PLAN_LABEL[(m.after.plan as PlanTier) ?? "PRO"]}${m.after.trialUntil ? ` · prueba hasta ${toDateInput(m.after.trialUntil)}` : ""}` : h.action;
                return <li key={h.id}><span className="text-gray-400">{fmt(h.createdAt)}</span> · <span className="text-gray-800">{line}</span>{m.reason ? <span className="text-gray-500"> · {m.reason}</span> : null}{h.user ? <span className="text-gray-400"> · {h.user.email}</span> : null}</li>;
              })}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
