"use client";

// Ficha de empresa del panel de proveedor (crm-planes P4/P4b): pestañas
// Licencia · Actividad · Usuarios · Centros · Auditoría. El cambio de plan pasa
// por un diálogo de confirmación; prueba, límite, activa y excepciones se guardan
// con "Guardar". El formulario se rellena con la respuesta del PATCH.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogIn, Save, Loader2, Check, Lock, Sparkles, Inbox, Flame, History } from "lucide-react";
import { apiFetch, ApiError, setActAsTenant } from "@/lib/api";
import { PLAN_LABEL, type PlanTier, type FeatureKey } from "@/lib/use-features";
import { PlanChip } from "@/components/plan-chip";
import { PlanChangeDialog } from "@/components/plan-change-dialog";
import { ConfirmDialog, type ConfirmSpec } from "@/components/confirm-dialog";

interface Detail {
  id: string; name: string; slug: string; active: boolean; plan: PlanTier; effectivePlan: PlanTier;
  trialUntil: string | null; trialDaysLeft: number | null; featureOverrides: { add?: FeatureKey[]; remove?: FeatureKey[] } | null; maxCenters: number | null;
  timezone: string | null; createdAt: string; features: FeatureKey[];
  admin: { email: string; name: string } | null;
  catalog: { key: FeatureKey; label: string; min: PlanTier; requires: FeatureKey[] }[];
  usersCount: number; customersCount: number;
  centers: { id: string; name: string; city: string | null; active: boolean }[];
  users: { id: string; email: string; firstName: string; lastName: string; role: string; active: boolean }[];
  history: { id: string; action: string; meta: Record<string, unknown> | null; createdAt: string; user: { email: string; firstName: string; lastName: string } | null }[];
  requests: { id: string; kind: "UPGRADE" | "TRIAL" | "CENTER"; status: "OPEN" | "APPROVED" | "REJECTED" | "CLOSED"; note: string | null; createdAt: string; closedAt: string | null }[];
  activity: { monthly: number[]; months: string[]; appointments30d: number; noShows30d: number; lastActivityAt: string | null; candidate: boolean; thresholds: { noShows30d: number; appointments30d: number } };
}
type Saved = { plan: PlanTier; trialUntil: string | null; maxCenters: number | null; active: boolean; featureOverrides: { add?: FeatureKey[]; remove?: FeatureKey[] } | null };
type Form = { trialUntil: string; maxCenters: string; active: boolean; add: FeatureKey[]; remove: FeatureKey[]; reason: string };
type Tab = "licencia" | "actividad" | "usuarios" | "centros" | "auditoria";

const CARD = "bg-white rounded-xl border border-gray-200 p-5";
const FIELD = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-ES") : "—");
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const toForm = (v: Saved): Form => ({ trialUntil: toDateInput(v.trialUntil), maxCenters: v.maxCenters != null ? String(v.maxCenters) : "", active: v.active, add: v.featureOverrides?.add ?? [], remove: v.featureOverrides?.remove ?? [], reason: "" });
const ROLE: Record<string, string> = { ADMIN: "Admin", RECEPTIONIST: "Recepción", DOCTOR: "Médico", SUPERADMIN: "Superadmin" };

// Línea legible de un cambio de licencia a partir del meta de la auditoría.
function historyLine(h: Detail["history"][number]): React.ReactNode {
  const mm = (h.meta ?? {}) as { before?: { plan?: string; trialUntil?: string | null }; after?: { plan?: string; trialUntil?: string | null }; plan?: string; reason?: string | null };
  const line = h.action === "CREATE"
    ? `Alta en ${PLAN_LABEL[(mm.plan as PlanTier) ?? "PRO"]}`
    : mm.before && mm.after
      ? `${PLAN_LABEL[(mm.before.plan as PlanTier) ?? "PRO"]} → ${PLAN_LABEL[(mm.after.plan as PlanTier) ?? "PRO"]}${mm.after.trialUntil ? ` · prueba hasta ${toDateInput(mm.after.trialUntil)}` : mm.before.trialUntil && !mm.after.trialUntil ? " · prueba retirada" : ""}`
      : h.action;
  return <>{line}{mm.reason ? <span className="text-gray-500"> · {mm.reason}</span> : null}</>;
}

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
  const [tab, setTab] = useState<Tab>("licencia");
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogTo, setDialogTo] = useState<PlanTier | null>(null);
  useEffect(() => { if (t && !form) setForm(toForm(t)); }, [t, form]);

  const save = useMutation({
    mutationFn: () => apiFetch<Saved>(`/superadmin/tenants/${id}`, { method: "PATCH", body: JSON.stringify({
      trialUntil: form!.trialUntil ? new Date(`${form!.trialUntil}T23:59:59`).toISOString() : null,
      maxCenters: form!.maxCenters ? Number(form!.maxCenters) : null,
      active: form!.active,
      featureOverrides: form!.add.length || form!.remove.length ? { add: form!.add, remove: form!.remove } : null,
      reason: form!.reason || undefined,
    }) }),
    onSuccess: (saved) => { setForm(toForm(saved)); setMsg("Cambios guardados"); setError(null); setTimeout(() => setMsg(null), 2500); void qc.invalidateQueries({ queryKey: ["superadmin-tenant", id] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); void qc.invalidateQueries({ queryKey: ["tenant-plan"] }); },
    onError: (e: unknown) => setError(errorMessage(e)),
  });
  // Decidir la petición abierta: aprobar la prueba (14 días), rechazar con motivo o cerrar.
  const decide = useMutation({
    mutationFn: (v: { rid: string; status: "APPROVED" | "REJECTED" | "CLOSED"; note?: string | undefined }) => apiFetch(`/superadmin/plan-requests/${v.rid}`, { method: "PATCH", body: JSON.stringify({ status: v.status, note: v.note, trialDays: 14 }) }),
    onSuccess: () => { setForm(null); void qc.invalidateQueries({ queryKey: ["superadmin-tenant", id] }); void qc.invalidateQueries({ queryKey: ["superadmin-plan-requests"] }); void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] }); },
  });
  // Confirmación previa de cada decisión (texto según la acción).
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const KIND_LABEL = { TRIAL: "la prueba Pro de 14 días", UPGRADE: "pasar a Pro", CENTER: "un centro adicional" } as const;
  function rejectReq(req: Detail["requests"][number]) {
    setConfirm({
      title: "Rechazar la petición",
      text: <>Vas a <b>rechazar</b> la petición de <b>{t?.name}</b> ({KIND_LABEL[req.kind]}). La clínica verá el motivo en su pantalla. ¿Estás seguro?</>,
      confirmLabel: "Rechazar petición", tone: "red", noteLabel: "Motivo del rechazo (lo verá la clínica)", noteRequired: true,
      onConfirm: (note) => decide.mutateAsync({ rid: req.id, status: "REJECTED", note }).then(() => undefined),
    });
  }
  function approveReq(req: Detail["requests"][number]) {
    const isTrial = req.kind === "TRIAL";
    setConfirm({
      title: isTrial ? "Aprobar la prueba Pro" : "Ampliar el límite de centros",
      text: isTrial
        ? <>Vas a aprobar la <b>prueba Pro de 14 días</b> para <b>{t?.name}</b>: se activa ahora mismo y tendrá abiertos todos los módulos Pro hasta que venza. ¿Estás seguro?</>
        : <>Vas a <b>ampliar en 1</b> el límite de centros contratados de <b>{t?.name}</b>. Podrá crear un centro más desde ya. ¿Estás seguro?</>,
      confirmLabel: isTrial ? "Aprobar prueba (14 d)" : "Ampliar límite (+1 centro)", tone: "green",
      onConfirm: () => decide.mutateAsync({ rid: req.id, status: "APPROVED" }).then(() => undefined),
    });
  }
  function closeReqConfirm(req: Detail["requests"][number]) {
    setConfirm({
      title: "Cerrar la petición",
      text: <>Vas a <b>cerrar</b> la petición de <b>{t?.name}</b> ({KIND_LABEL[req.kind]}) sin cambiar su plan. ¿Estás seguro?</>,
      confirmLabel: "Cerrar petición", tone: "blue",
      onConfirm: () => decide.mutateAsync({ rid: req.id, status: "CLOSED" }).then(() => undefined),
    });
  }

  if (isLoading || !t || !form) return <div className="p-6 text-sm text-gray-400">Cargando…</div>;

  const trialActive = !!form.trialUntil && new Date(`${form.trialUntil}T23:59:59`) > new Date();
  const effectiveNow: PlanTier = trialActive ? "PRO" : t.plan;
  const openReq = t.requests.find((r) => r.status === "OPEN") ?? null;
  const setTrialDays = (days: number | null) => setForm({ ...form, trialUntil: days ? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) : "" });
  const toggle = (list: "add" | "remove", k: FeatureKey) => setForm((f) => f && ({ ...f, [list]: f[list].includes(k) ? f[list].filter((x) => x !== k) : [...f[list], k], ...(list === "add" ? { remove: f.remove.filter((x) => x !== k) } : { add: f.add.filter((x) => x !== k) }) }));
  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: "licencia", label: "Licencia" }, { k: "actividad", label: "Actividad" }, { k: "usuarios", label: "Usuarios", n: t.users.length }, { k: "centros", label: "Centros", n: t.centers.length }, { k: "auditoria", label: "Auditoría", n: t.history.length },
  ];
  const a = t.activity;
  const maxM = Math.max(...a.monthly, 1);

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/superadmin/empresas" className="text-gray-400 hover:text-gray-600 text-sm inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Empresas</Link>
        <h1 className="text-xl font-semibold text-gray-900">{t.name}</h1>
        <PlanChip plan={t.effectivePlan} />
        {t.trialDaysLeft != null && <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Prueba · {t.trialDaysLeft} días</span>}
        {openReq && <span className="text-xs font-semibold text-blue-800 bg-blue-100 border border-blue-300 rounded-full px-2 py-0.5">Petición abierta · {fmtDay(openReq.createdAt)}</span>}
        {!t.active && <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Suspendida</span>}
        <button type="button" onClick={() => { setActAsTenant(t.id); window.location.href = "/dashboard"; }} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><LogIn className="w-4 h-4" /> Entrar como esta empresa</button>
      </div>
      <p className="text-sm text-gray-500">{t.slug} · {t.timezone ?? "—"} · {t.centers.filter((c) => c.active).length} centro{t.centers.filter((c) => c.active).length === 1 ? "" : "s"} · {t.usersCount} usuario{t.usersCount === 1 ? "" : "s"} · {t.customersCount} paciente{t.customersCount === 1 ? "" : "s"} · alta {fmtDay(t.createdAt)}{t.admin ? ` · admin: ${t.admin.name} (${t.admin.email})` : ""}</p>

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-gray-200 flex-wrap">
        {tabs.map((x) => (
          <button key={x.k} type="button" onClick={() => setTab(x.k)} className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors inline-flex items-center gap-1.5 ${tab === x.k ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {x.label}{x.n != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{x.n}</span>}
          </button>
        ))}
      </div>

      {tab === "licencia" && (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
          <section className={`${CARD} space-y-4`}>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-500" /> Licencia</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">Plan contratado</span>
                <div className="flex items-center gap-2 h-[38px]">
                  <PlanChip plan={t.plan} />
                  {t.plan === "PRO"
                    ? <button type="button" onClick={() => setDialogTo("ESSENTIAL")} className="text-xs font-semibold text-amber-700 hover:underline">Cambiar a Esencial…</button>
                    : <button type="button" onClick={() => setDialogTo("PRO")} className="text-xs font-semibold text-blue-700 hover:underline">Pasar a Pro…</button>}
                </div>
              </div>
              <label className="block"><span className="text-xs font-medium text-gray-600">Prueba Pro hasta</span>
                <input type="date" value={form.trialUntil} onChange={(e) => setForm({ ...form, trialUntil: e.target.value })} className={FIELD} /></label>
              <label className="block"><span className="text-xs font-medium text-gray-600">Límite de centros</span>
                <input type="number" min={1} value={form.maxCenters} onChange={(e) => setForm({ ...form, maxCenters: e.target.value })} placeholder="sin límite" className={FIELD} /></label>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-gray-500 mr-1">Prueba rápida:</span>
              {[14, 30, 60].map((d) => <button key={d} type="button" onClick={() => setTrialDays(d)} className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-semibold hover:bg-gray-50">{d} días</button>)}
              {form.trialUntil && <button type="button" onClick={() => setTrialDays(null)} className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-50">Quitar prueba</button>}
            </div>
            <div className="flex items-center gap-2 flex-wrap bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-gray-600">
              <span>Con estos valores la clínica tendrá</span><PlanChip plan={effectiveNow} />
              {trialActive && t.plan === "ESSENTIAL" ? <><span>hasta el {new Date(form.trialUntil).toLocaleDateString("es-ES")} y después</span><PlanChip plan="ESSENTIAL" /></> : null}
            </div>

            <details className="border border-gray-200 rounded-lg px-3 py-2.5" open={form.add.length > 0 || form.remove.length > 0}>
              <summary className="cursor-pointer text-[13px] font-semibold text-gray-700">Ajustes avanzados · funciones por excepción{form.add.length + form.remove.length > 0 ? ` (${form.add.length + form.remove.length})` : ""}</summary>
              <p className="text-xs text-gray-500 mt-2 mb-2">Activar una función Pro aunque la empresa siga en Esencial, o quitarle una concreta. Las dependencias se validan al guardar.</p>
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {t.catalog.map((c) => {
                  const base = c.min === "ESSENTIAL" || effectiveNow === "PRO";
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
            </details>

            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
              <label className="block"><span className="text-xs font-medium text-gray-600">Motivo del cambio (queda en la auditoría)</span><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="p. ej. prueba acordada por teléfono" className={FIELD} /></label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 pb-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-blue-600" /> Empresa activa</label>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar</button>
              {msg && <span className="text-sm text-emerald-700 inline-flex items-center gap-1"><Check className="w-4 h-4" /> {msg}</span>}
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </section>

          <div className="space-y-4">
            <ActivityCard a={a} maxM={maxM} plan={t.plan} />
            <section className={CARD}>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2"><Inbox className="w-4 h-4 text-blue-500" /> {openReq ? "Petición abierta" : "Peticiones"}</h2>
              {openReq ? (
                <>
                  <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border mb-2 ${openReq.kind === "TRIAL" ? "bg-amber-100 text-amber-800 border-amber-300" : openReq.kind === "CENTER" ? "bg-violet-100 text-violet-800 border-violet-300" : "bg-blue-100 text-blue-800 border-blue-300"}`}>{openReq.kind === "TRIAL" ? "Prueba 14 días" : openReq.kind === "CENTER" ? "Centro adicional" : "Pasar a Pro"}</span>
                  <p className="text-sm text-gray-700">{t.admin ? <b>{t.admin.name}</b> : "La clínica"} {openReq.kind === "TRIAL" ? "pidió la prueba Pro" : openReq.kind === "CENTER" ? "pidió un centro adicional" : "pidió pasar a Pro"} el {fmtDay(openReq.createdAt)}{openReq.note && openReq.kind !== "TRIAL" ? <>: <i>“{openReq.note}”</i></> : "."}</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {openReq.kind === "TRIAL"
                      ? <button type="button" onClick={() => approveReq(openReq)} disabled={decide.isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Aprobar prueba (14 d)</button>
                      : openReq.kind === "CENTER"
                      ? <button type="button" onClick={() => approveReq(openReq)} disabled={decide.isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Ampliar límite (+1 centro)</button>
                      : t.plan === "ESSENTIAL" && <button type="button" onClick={() => setDialogTo("PRO")} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Sparkles className="w-3.5 h-3.5" /> Pasar a Pro</button>}
                    <button type="button" onClick={() => rejectReq(openReq)} disabled={decide.isPending} className="text-xs font-medium px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60">Rechazar</button>
                    {openReq.kind === "UPGRADE" && <button type="button" onClick={() => closeReqConfirm(openReq)} disabled={decide.isPending} className="text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">Cerrar</button>}
                  </div>
                </>
              ) : <p className="text-sm text-gray-400">Ninguna abierta.{t.requests.length > 0 ? ` ${t.requests.length} anterior(es): ${t.requests.map((r) => r.status === "APPROVED" ? "aprobada" : r.status === "REJECTED" ? "rechazada" : "cerrada").join(", ")}.` : ""}</p>}
            </section>

            {/* Últimos cambios de licencia (resumen; el historial completo está en Auditoría) */}
            <section className={CARD}>
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><History className="w-4 h-4 text-gray-400" /> Últimos cambios</h2>
                {t.history.length > 5 && <button type="button" onClick={() => setTab("auditoria")} className="text-xs font-semibold text-blue-600 hover:underline">Ver todo ({t.history.length}) →</button>}
              </div>
              {t.history.length === 0 ? <p className="text-sm text-gray-400">Sin cambios registrados.</p> : (
                <ul className="text-xs space-y-1.5">{t.history.slice(0, 5).map((h) => (
                  <li key={h.id} className="flex gap-2"><span className="text-gray-400 whitespace-nowrap tabular-nums">{fmt(h.createdAt).slice(0, 10)}</span><span className="text-gray-800 min-w-0">{historyLine(h)}</span></li>
                ))}</ul>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === "actividad" && (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-1">Citas por mes</h2>
            <p className="text-xs text-gray-500 mb-4">Últimos 6 meses, por fecha de cita.</p>
            <div className="flex items-end gap-3 h-40">
              {a.monthly.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
                  <span className="text-xs font-semibold text-gray-700 tabular-nums">{v}</span>
                  <div className={`w-full rounded-t ${i === 5 ? "bg-blue-600" : "bg-blue-200"}`} style={{ height: `${Math.max(4, Math.round((v / maxM) * 110))}px` }} />
                  <span className="text-[11px] text-gray-400">{a.months[i] ? MONTHS[Number(a.months[i]!.slice(5, 7)) - 1] : ""}</span>
                </div>
              ))}
            </div>
          </section>
          <ActivityCard a={a} maxM={maxM} plan={t.plan} compact />
        </div>
      )}

      {tab === "usuarios" && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">{["Usuario", "Email", "Rol", "Estado"].map((h) => <th key={h} className="text-left font-semibold px-3 py-2 border-b border-gray-200">{h}</th>)}</tr></thead>
            <tbody>
              {t.users.length === 0 ? <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">Sin usuarios.</td></tr> : t.users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2.5 font-medium text-gray-900">{u.firstName} {u.lastName}</td>
                  <td className="px-3 py-2.5 text-gray-600">{u.email}</td>
                  <td className="px-3 py-2.5"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{ROLE[u.role] ?? u.role}</span></td>
                  <td className="px-3 py-2.5">{u.active ? <span className="text-xs text-emerald-700">activo</span> : <span className="text-xs text-gray-400">inactivo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "centros" && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Centros ({t.centers.filter((c) => c.active).length}{t.maxCenters != null ? ` / ${t.maxCenters} contratados` : " · sin límite"})</h2>
          {t.centers.length === 0 ? <p className="text-sm text-gray-400">Sin centros todavía. La clínica los crea desde Administración → Centros.</p> : (
            <ul className="divide-y divide-gray-100">{t.centers.map((c) => <li key={c.id} className={`py-2 text-sm flex items-center gap-2 ${c.active ? "text-gray-800" : "text-gray-400 line-through"}`}>{c.name}{c.city ? <span className="text-gray-400 no-underline"> · {c.city}</span> : null}{!c.active && <span className="text-[10px] text-gray-400">(desactivado)</span>}</li>)}</ul>
          )}
        </section>
      )}

      {tab === "auditoria" && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Historial de licencia</h2>
          {t.history.length === 0 ? <p className="text-sm text-gray-400">Sin cambios registrados.</p> : (
            <ul className="text-sm space-y-2">{t.history.map((h) => (
              <li key={h.id} className="flex gap-3"><span className="text-gray-400 whitespace-nowrap tabular-nums">{fmt(h.createdAt)}</span><span className="text-gray-800">{historyLine(h)}{h.user ? <span className="text-gray-400"> · {h.user.email}</span> : null}</span></li>
            ))}</ul>
          )}
        </section>
      )}

      {dialogTo && <PlanChangeDialog tenant={{ id: t.id, name: t.name, plan: t.plan, centersCount: t.centers.filter((c) => c.active).length, openRequests: t.requests.filter((r) => r.status === "OPEN").length, adminName: t.admin?.name ?? null }} to={dialogTo} catalog={t.catalog} onClose={() => setDialogTo(null)} onDone={() => setForm(null)} />}
      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function ActivityCard({ a, maxM, plan, compact }: { a: Detail["activity"]; maxM: number; plan: PlanTier; compact?: boolean }) {
  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-gray-900">Actividad</h2><span className="text-[11px] text-gray-400">30 días</span></div>
      {!compact && (
        <div className="flex items-end gap-1.5 h-14 mt-3">
          {a.monthly.map((v, i) => <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full"><div className={`w-full rounded-t ${i === 5 ? "bg-blue-600" : "bg-blue-200"}`} style={{ height: `${Math.max(3, Math.round((v / maxM) * 40))}px` }} title={`${v} citas`} /><span className="text-[10px] text-gray-400">{a.months[i] ? MONTHS[Number(a.months[i]!.slice(5, 7)) - 1] : ""}</span></div>)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div><div className="text-lg font-bold tabular-nums">{a.appointments30d}</div><div className="text-[10px] text-gray-500">citas</div></div>
        <div><div className={`text-lg font-bold tabular-nums ${a.noShows30d >= a.thresholds.noShows30d ? "text-red-600" : ""}`}>{a.noShows30d}</div><div className="text-[10px] text-gray-500">no-shows</div></div>
        <div><div className="text-lg font-bold tabular-nums">{a.lastActivityAt ? fmtDay(a.lastActivityAt) : "—"}</div><div className="text-[10px] text-gray-500">última cita</div></div>
      </div>
      {a.candidate && plan === "ESSENTIAL" && <p className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 inline-flex items-start gap-1.5"><Flame className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Candidata a Pro: con {a.noShows30d} no-shows al mes, la recuperación automática se paga sola.</p>}
    </section>
  );
}
