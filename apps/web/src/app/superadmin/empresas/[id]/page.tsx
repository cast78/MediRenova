"use client";

// Ficha de empresa del panel de proveedor (crm-planes P4/P4b): pestañas
// Licencia · Actividad · Usuarios · Centros · Auditoría. El cambio de plan pasa
// por un diálogo de confirmación; prueba, límite, activa y excepciones se guardan
// con "Guardar". El formulario se rellena con la respuesta del PATCH.
import { DataTable } from "@/components/ui/data-table";
import { TabsScroller } from "@/components/ui/tabs-scroller";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogIn, Save, Loader2, Check, Lock, Sparkles, Inbox, Flame, History, Hash, Globe, Building2, Users, ContactRound, CalendarDays, UserCog, Clock, AlertTriangle, Leaf, Ban, UserX, Activity, Search, ShieldCheck, Headset, Stethoscope, MapPin, LayoutGrid, Bot, Mail, ArrowDownCircle, Minus, SlidersHorizontal, type LucideIcon } from "lucide-react";
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
  centers: { id: string; name: string; city: string | null; active: boolean; createdAt: string; roomsCount: number; appointments30d: number }[];
  users: { id: string; email: string; firstName: string; lastName: string; role: string; active: boolean; createdAt: string; lastLoginAt: string | null }[];
  history: { id: string; action: string; meta: Record<string, unknown> | null; createdAt: string; user: { email: string; firstName: string; lastName: string } | null }[];
  requests: { id: string; kind: "UPGRADE" | "TRIAL" | "CENTER"; status: "OPEN" | "APPROVED" | "REJECTED" | "CLOSED"; note: string | null; createdAt: string; closedAt: string | null }[];
  activity: { monthly: number[]; monthlyNoShows: number[]; months: string[]; appointments30d: number; prevAppointments30d: number; noShows30d: number; lastActivityAt: string | null; candidate: boolean; thresholds: { noShows30d: number; appointments30d: number } };
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
// Roles del equipo de la clínica: etiqueta, chip y avatar (mismos colores que el mockup).
const ROLE_META: Record<string, { label: string; chip: string; avatar: string; Icon: LucideIcon }> = {
  ADMIN: { label: "Administrador", chip: "bg-blue-50 text-blue-700 border-blue-200", avatar: "bg-blue-50 text-blue-700", Icon: ShieldCheck },
  RECEPTIONIST: { label: "Recepción", chip: "bg-gray-100 text-gray-700 border-gray-200", avatar: "bg-gray-100 text-gray-700", Icon: Headset },
  DOCTOR: { label: "Médico", chip: "bg-teal-50 text-teal-700 border-teal-200", avatar: "bg-teal-50 text-teal-700", Icon: Stethoscope },
  SUPERADMIN: { label: "Superadmin", chip: "bg-gray-100 text-gray-700 border-gray-200", avatar: "bg-gray-100 text-gray-700", Icon: ShieldCheck },
};
const DEFAULT_ROLE = { label: "—", chip: "bg-gray-100 text-gray-700 border-gray-200", avatar: "bg-gray-100 text-gray-700", Icon: ContactRound };
const initials = (first: string, last: string) => `${first.trim()[0] ?? ""}${last.trim()[0] ?? ""}`.toUpperCase() || "·";
// "Hoy, 09:40" · "Ayer, 18:40" · "13/11/2026" para accesos y última actividad.
function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return diff === 0 ? `Hoy, ${hm}` : diff === 1 ? `Ayer, ${hm}` : d.toLocaleDateString("es-ES");
}
const fmtLong = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

// Entrada de la línea de tiempo de Auditoría: cambios de licencia (auditoría) y
// peticiones de la clínica, con tipo para el filtro y el color del icono.
type EntryKind = "plan" | "prueba" | "centros" | "peticion" | "auto" | "otro";
type Entry = { id: string; at: string; kind: EntryKind; title: string; who: string | null; note: string | null; auto: boolean; chip?: { label: string; cls: string }; style?: { Icon: LucideIcon; cls: string } };
const KIND_STYLE: Record<EntryKind, { Icon: LucideIcon; cls: string }> = {
  plan: { Icon: Sparkles, cls: "bg-blue-50 text-blue-700" },
  prueba: { Icon: Clock, cls: "bg-amber-50 text-amber-700" },
  centros: { Icon: Building2, cls: "bg-violet-50 text-violet-700" },
  peticion: { Icon: Inbox, cls: "bg-violet-50 text-violet-700" },
  auto: { Icon: ArrowDownCircle, cls: "bg-emerald-50 text-emerald-700" },
  otro: { Icon: SlidersHorizontal, cls: "bg-gray-100 text-gray-600" },
};
const REQ_STATUS: Record<Detail["requests"][number]["status"], { label: string; cls: string }> = {
  OPEN: { label: "Abierta", cls: "bg-violet-100 text-violet-800 border-violet-300" },
  APPROVED: { label: "Aprobada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  REJECTED: { label: "Rechazada", cls: "bg-red-50 text-red-700 border-red-200" },
  CLOSED: { label: "Cerrada", cls: "bg-gray-100 text-gray-600 border-gray-200" },
};
function entryOfHistory(h: Detail["history"][number]): Entry {
  type Snap = { plan?: string; trialUntil?: string | null; maxCenters?: number | null; active?: boolean; featureOverrides?: unknown };
  const mm = (h.meta ?? {}) as { event?: string; daysLeft?: number; before?: Snap; after?: Snap; plan?: string; reason?: string | null };
  const who = h.user ? (`${h.user.firstName} ${h.user.lastName}`.trim() || h.user.email) : null;
  const base = { id: h.id, at: h.createdAt, who, note: mm.reason ?? null, auto: false };
  if (mm.event === "TRIAL_NOTICE") return { ...base, kind: "auto", title: `Aviso: la prueba Pro ${mm.daysLeft === 1 ? "vence mañana" : `vence en ${mm.daysLeft} días`}`, who: "Proceso diario · email a la clínica y al proveedor", note: null, auto: true, style: { Icon: Mail, cls: "bg-amber-50 text-amber-700" } };
  if (mm.event === "TRIAL_EXPIRED") return { ...base, kind: "auto", title: `Fin de la prueba Pro → ${PLAN_LABEL.ESSENTIAL}`, who: "Proceso diario de vencimiento · email a la clínica y al proveedor", note: null, auto: true };
  if (h.action === "CREATE") return { ...base, kind: "plan", title: `Alta de la empresa · plan ${PLAN_LABEL[(mm.plan as PlanTier) ?? "PRO"]}` };
  const b = mm.before, a = mm.after;
  if (b && a) {
    if (b.plan !== a.plan) return { ...base, kind: "plan", title: `${PLAN_LABEL[(b.plan as PlanTier) ?? "PRO"]} → ${PLAN_LABEL[(a.plan as PlanTier) ?? "PRO"]}${a.trialUntil && a.trialUntil !== b.trialUntil ? ` · prueba hasta el ${fmtDay(a.trialUntil)}` : ""}` };
    if ((b.trialUntil ?? null) !== (a.trialUntil ?? null)) return { ...base, kind: "prueba", title: a.trialUntil ? `Prueba Pro hasta el ${fmtDay(a.trialUntil)}` : "Prueba Pro retirada" };
    if ((b.maxCenters ?? null) !== (a.maxCenters ?? null)) return { ...base, kind: "centros", title: `Límite de centros: ${b.maxCenters ?? "sin límite"} → ${a.maxCenters ?? "sin límite"}` };
    if (b.active !== a.active) return { ...base, kind: "otro", title: a.active ? "Empresa reactivada" : "Empresa marcada como suspendida" };
    if (JSON.stringify(b.featureOverrides ?? null) !== JSON.stringify(a.featureOverrides ?? null)) return { ...base, kind: "otro", title: "Excepciones por función actualizadas" };
    return { ...base, kind: "otro", title: "Guardado sin cambios" };
  }
  return { ...base, kind: "otro", title: h.action };
}
function entryOfRequest(r: Detail["requests"][number]): Entry {
  const what = r.kind === "TRIAL" ? "prueba Pro de 14 días" : r.kind === "CENTER" ? "centro adicional" : "paso a Pro";
  // Icono de bandeja en el color del tipo de petición (ámbar prueba · azul Pro · lila centro).
  const cls = r.kind === "TRIAL" ? "bg-amber-50 text-amber-700" : r.kind === "CENTER" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700";
  return { id: `req-${r.id}`, at: r.createdAt, kind: "peticion", title: `Petición de ${what}`, who: "Pedida por la clínica desde su panel", note: r.note, auto: false, chip: REQ_STATUS[r.status], style: { Icon: Inbox, cls } };
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
  // Filtros locales de Usuarios (búsqueda y estado) y Auditoría (tipo de entrada).
  const [userQ, setUserQ] = useState("");
  const [userF, setUserF] = useState<"all" | "active" | "inactive">("all");
  const [auditF, setAuditF] = useState<"all" | EntryKind>("all");
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
  // La empresa tiene hoy una prueba en curso y el formulario la retira o la deja
  // en el pasado: avisar antes de guardar (la acción rápida del panel ya confirma).
  const removingTrial = !!t.trialUntil && new Date(t.trialUntil) > new Date() && !trialActive && t.plan === "ESSENTIAL";
  // Puede haber varias abiertas a la vez (una de plan y una de centro).
  const openReqs = t.requests.filter((r) => r.status === "OPEN");
  const setTrialDays = (days: number | null) => setForm({ ...form, trialUntil: days ? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) : "" });
  const toggle = (list: "add" | "remove", k: FeatureKey) => setForm((f) => f && ({ ...f, [list]: f[list].includes(k) ? f[list].filter((x) => x !== k) : [...f[list], k], ...(list === "add" ? { remove: f.remove.filter((x) => x !== k) } : { add: f.add.filter((x) => x !== k) }) }));
  // Cada pestaña con su color (texto y subrayado al activarse; icono siempre):
  // Licencia azul · Actividad verde · Usuarios verde azulado · Centros lila · Auditoría gris.
  const tabs: { k: Tab; label: string; Icon: LucideIcon; n?: number; on: string; icon: string; badge: string }[] = [
    { k: "licencia", label: "Licencia", Icon: Lock, on: "border-blue-600 text-blue-700", icon: "text-blue-600", badge: "bg-blue-50 text-blue-700" },
    { k: "actividad", label: "Actividad", Icon: Activity, on: "border-emerald-600 text-emerald-700", icon: "text-emerald-600", badge: "bg-emerald-50 text-emerald-700" },
    { k: "usuarios", label: "Usuarios", Icon: Users, n: t.users.length, on: "border-teal-600 text-teal-700", icon: "text-teal-600", badge: "bg-teal-50 text-teal-700" },
    { k: "centros", label: "Centros", Icon: Building2, n: t.centers.length, on: "border-violet-600 text-violet-700", icon: "text-violet-600", badge: "bg-violet-50 text-violet-700" },
    { k: "auditoria", label: "Auditoría", Icon: History, n: t.history.length + t.requests.length, on: "border-gray-700 text-gray-800", icon: "text-gray-600", badge: "bg-gray-200 text-gray-700" },
  ];
  // Chip por petición abierta, con el color e icono de su tipo (como en el panel).
  const REQ_CHIP = { TRIAL: { label: "Prueba pedida", cls: "bg-amber-50 text-amber-800 border-amber-200", Icon: Clock }, UPGRADE: { label: "Pasar a Pro pedido", cls: "bg-blue-50 text-blue-800 border-blue-200", Icon: Sparkles }, CENTER: { label: "Centro adicional pedido", cls: "bg-violet-50 text-violet-800 border-violet-200", Icon: Building2 } } as const;
  const a = t.activity;
  const maxM = Math.max(...a.monthly, 1);
  const activeCenters = t.centers.filter((c) => c.active).length;
  const enterAs = () => { setActAsTenant(t.id); window.location.href = "/dashboard"; };
  const last = t.history[0] ? entryOfHistory(t.history[0]) : null;
  const lastStyle = last ? (last.style ?? KIND_STYLE[last.kind]) : KIND_STYLE.otro;

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <Link href="/superadmin/empresas" className="text-gray-400 hover:text-gray-600 text-[13px] inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Empresas</Link>

      {/* Cabecera común: identidad de la empresa (icono, nombre y chips de estado),
          datos de contacto y cifras con el mismo lenguaje que las pestañas. */}
      <section className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 flex items-start gap-4 flex-wrap">
          <span aria-hidden className="w-11 h-11 rounded-[10px] bg-blue-50 text-blue-600 inline-flex items-center justify-center shrink-0"><Building2 className="w-[22px] h-[22px]" /></span>
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900 leading-tight">{t.name}</h1>
              <PlanChip plan={t.plan} />
              {t.trialDaysLeft != null && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><Clock className="w-3 h-3" />Prueba · {t.trialDaysLeft} día{t.trialDaysLeft === 1 ? "" : "s"}</span>}
              {openReqs.map((r) => { const c = REQ_CHIP[r.kind]; return <span key={r.id} className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full border px-2 py-0.5 ${c.cls}`}><c.Icon className="w-3 h-3" />{c.label} · {fmtDay(r.createdAt)}</span>; })}
              {!t.active && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><Ban className="w-3 h-3" />Suspendida</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-gray-500">
              <span className="inline-flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-gray-400" /><code className="font-mono text-xs text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">{t.slug}</code></span>
              <span className="inline-flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-gray-400" />{t.timezone ?? "—"}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-gray-400" />alta {fmtDay(t.createdAt)}</span>
              {t.admin && <span className="inline-flex items-center gap-1.5 min-w-0"><UserCog className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="truncate">{t.admin.name} · <a href={`mailto:${t.admin.email}`} className="text-blue-600 hover:underline">{t.admin.email}</a></span></span>}
            </div>
          </div>
          {/* Acción principal de la ficha: sólida en el azul de marca, como "Guardar";
              la nota recuerda que queda auditado. */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <button type="button" onClick={enterAs} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm"><LogIn className="w-4 h-4" /> Entrar como esta empresa</button>
            <span className="text-[11px] text-gray-400">Verás su panel como su administrador · queda auditado</span>
          </div>
        </div>
        {/* Sin pie de cifras: centros y usuarios ya llevan contador en su pestaña
            (el pie con atajos queda documentado como mejora junto a la pestaña Pacientes). */}
      </section>

      {/* Pestañas con icono y contador */}
      <TabsScroller variant="underline">
        {tabs.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k)} className={`px-3.5 py-2.5 text-sm -mb-px border-b-2 transition-colors inline-flex items-center gap-1.5 ${tab === x.k ? `${x.on} font-semibold` : "border-transparent text-gray-500 font-medium hover:text-gray-700"}`}>
            <x.Icon className={`w-4 h-4 ${tab === x.k ? x.icon : `${x.icon} opacity-70`}`} />{x.label}{x.n != null && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums ${tab === x.k ? x.badge : "bg-gray-100 text-gray-500"}`}>{x.n}</span>}
          </button>
        ))}
      </TabsScroller>

      {tab === "licencia" && (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
          <section className={`${CARD} space-y-4`}>
            <h2 className="font-semibold text-gray-900 flex items-center justify-between gap-2">Licencia <PlanChip plan={t.plan} /></h2>
            {/* Plan contratado (con el cambio de plan como botón secundario, no como enlace)
                y límite de centros (dos dígitos como mucho: campo estrecho). */}
            <div className="space-y-3">
              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">Cambio de plan:</span>
                <div className="flex items-center gap-2.5 h-[38px]">
                  {t.plan === "PRO"
                    ? <button type="button" onClick={() => setDialogTo("ESSENTIAL")} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><Leaf className="w-3.5 h-3.5" /> Cambiar a Esencial…</button>
                    : <button type="button" onClick={() => setDialogTo("PRO")} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"><Sparkles className="w-3.5 h-3.5" /> Pasar a Pro…</button>}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs"><span className="font-medium text-gray-600">Límite de centros:</span>
                <input type="number" min={1} max={99} value={form.maxCenters} onChange={(e) => setForm({ ...form, maxCenters: e.target.value })} placeholder="∞" title="Vacío = sin límite" className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-700 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-gray-400">vacío = sin límite</span></label>
            </div>
            {/* Prueba Pro: la fecha y los atajos en la misma fila, a la misma altura.
                Solo con plan contratado Esencial: con Pro no hay nada que probar. */}
            {t.plan === "ESSENTIAL" ? (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="font-medium text-gray-600 mr-1">Prueba Pro:</span>
              {[14, 30, 60].map((d) => <button key={d} type="button" onClick={() => setTrialDays(d)} className="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 font-semibold hover:bg-amber-100">{d} días</button>)}
              <label className="inline-flex items-center gap-1.5 ml-1"><span className="text-gray-500">hasta</span>
                <input type="date" value={form.trialUntil} onChange={(e) => setForm({ ...form, trialUntil: e.target.value })} className="h-[30px] border border-gray-300 rounded-lg px-2 py-0 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" /></label>
              {form.trialUntil && <button type="button" onClick={() => setTrialDays(null)} className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-red-600 font-semibold hover:bg-red-50">Quitar prueba</button>}
            </div>
            ) : null}
            {(effectiveNow !== t.plan || form.add.length + form.remove.length > 0) && (
            <div className="flex items-center gap-2 flex-wrap bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-gray-600">
              <span>Con estos valores la clínica tendrá</span><PlanChip plan={effectiveNow} />
              {trialActive && t.plan === "ESSENTIAL" ? <><span>hasta el {new Date(form.trialUntil).toLocaleDateString("es-ES")} y después</span><PlanChip plan="ESSENTIAL" /></> : null}
              {form.add.length + form.remove.length > 0 && <span className="text-gray-500">· con {form.add.length + form.remove.length} excepci{form.add.length + form.remove.length === 1 ? "ón" : "ones"}</span>}
            </div>
            )}
            {removingTrial && (
              <p className="flex items-start gap-2 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Al guardar <b>retirarás la prueba Pro</b>: la clínica volverá a <b>Esencial</b> desde ahora y los módulos Pro quedarán bloqueados (sus datos se conservan). Indica el motivo: queda en la auditoría.</span>
              </p>
            )}

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
              <label className="block"><span className="text-xs font-medium text-gray-600">Motivo del cambio (queda en la auditoría):</span><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="p. ej. prueba acordada por teléfono" className={FIELD} /></label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 pb-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-blue-600" /> Empresa activa</label>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar</button>
              {msg && <span className="text-sm text-emerald-700 inline-flex items-center gap-1"><Check className="w-4 h-4" /> {msg}</span>}
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </section>

          <div className="space-y-3">
            {/* Último cambio registrado (tarjeta discreta); el historial completo está en Auditoría. */}
            {last && (
              <section className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0 ${lastStyle.cls}`}><lastStyle.Icon className="w-3.5 h-3.5" /></span>
                  <span className="min-w-0 flex flex-col gap-0.5"><span className="text-gray-500">Último cambio: <span className="font-medium text-gray-800">{last.title}</span></span><span className="text-gray-400 tabular-nums truncate">{fmt(last.at)} · {last.auto ? "automático" : last.who ?? "—"}</span></span>
                </span>
                <button type="button" onClick={() => setTab("auditoria")} className="font-semibold text-blue-600 hover:underline shrink-0">Ver historial →</button>
              </section>
            )}
            <ActivityCard a={a} plan={t.plan} onMore={() => setTab("actividad")} />
            <section className={CARD}>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2"><Inbox className="w-4 h-4 text-blue-500" /> {openReqs.length > 1 ? "Peticiones abiertas" : openReqs.length === 1 ? "Petición abierta" : "Peticiones"}</h2>
              {openReqs.length > 0 ? openReqs.map((openReq) => (
                <div key={openReq.id} className="[&+&]:mt-3 [&+&]:pt-3 [&+&]:border-t [&+&]:border-gray-100">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border mb-2 ${openReq.kind === "TRIAL" ? "bg-amber-100 text-amber-800 border-amber-300" : openReq.kind === "CENTER" ? "bg-violet-100 text-violet-800 border-violet-300" : "bg-blue-100 text-blue-800 border-blue-300"}`}>{openReq.kind === "TRIAL" ? <Clock className="w-3 h-3" /> : openReq.kind === "CENTER" ? <Building2 className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}{openReq.kind === "TRIAL" ? "Prueba 14 días" : openReq.kind === "CENTER" ? "Centro adicional" : "Pasar a Pro"}</span>
                  <p className="text-[13px] leading-relaxed text-gray-600">{t.admin ? <b className="font-semibold text-gray-900">{t.admin.name}</b> : "La clínica"} {openReq.kind === "TRIAL" ? "pidió la prueba Pro" : openReq.kind === "CENTER" ? "pidió un centro adicional" : "pidió pasar a Pro"} el {fmtDay(openReq.createdAt)}{openReq.note && openReq.kind !== "TRIAL" ? <>: <i>“{openReq.note}”</i></> : "."}</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {openReq.kind === "TRIAL"
                      ? <button type="button" onClick={() => approveReq(openReq)} disabled={decide.isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Aprobar prueba (14 d)</button>
                      : openReq.kind === "CENTER"
                      ? <button type="button" onClick={() => approveReq(openReq)} disabled={decide.isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Ampliar límite (+1 centro)</button>
                      : t.plan === "ESSENTIAL" && <button type="button" onClick={() => setDialogTo("PRO")} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Sparkles className="w-3.5 h-3.5" /> Pasar a Pro</button>}
                    <button type="button" onClick={() => rejectReq(openReq)} disabled={decide.isPending} className="text-xs font-medium px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60">Rechazar</button>
                    {openReq.kind === "UPGRADE" && <button type="button" onClick={() => closeReqConfirm(openReq)} disabled={decide.isPending} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"><Ban className="w-3.5 h-3.5" /> Cerrar</button>}
                  </div>
                </div>
              )) : <p className="text-[13px] text-gray-400">Ninguna abierta.{t.requests.length > 0 ? <> {t.requests.length} anterior{t.requests.length === 1 ? "" : "es"} en <button type="button" onClick={() => setTab("auditoria")} className="font-semibold text-blue-600 hover:underline">Auditoría</button>.</> : ""}</p>}
            </section>
          </div>
        </div>
      )}

      {tab === "actividad" && (
        <div className="space-y-4">
          {/* Indicadores de 30 días con el color de cada lectura. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Citas · 30 días" Icon={CalendarDays} tone="blue" value={a.appointments30d} sub={`${a.prevAppointments30d} en los 30 días anteriores`} />
            <Kpi label="No-shows · 30 días" Icon={UserX} tone="amber" value={a.noShows30d} sub={a.appointments30d > 0 ? `${Math.round((a.noShows30d / a.appointments30d) * 100)} % de las citas` : "sin citas en el periodo"} />
            <Kpi label="Última actividad" Icon={Activity} tone="emerald" value={fmtRel(a.lastActivityAt)} sub="última cita registrada" small />
            <Kpi label="Lectura comercial" Icon={t.plan === "PRO" ? Sparkles : Flame} tone={t.plan === "PRO" ? "blue" : "orange"} sub={t.plan === "PRO" ? "ya usa la recuperación de no-shows" : a.candidate ? "cumple algún umbral" : "sin umbral cumplido"}
              chip={t.plan === "PRO" ? { label: "Plan Pro en uso", cls: "bg-blue-50 text-blue-800 border-blue-200" } : a.candidate ? { label: "Candidata a Pro", cls: "bg-orange-50 text-orange-800 border-orange-200" } : { label: "Sin señal", cls: "bg-gray-100 text-gray-600 border-gray-200" }} />
          </div>

          {/* Citas por mes: barra azul por mes con el tramo de no-shows en ámbar. */}
          <section className={CARD}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Citas por mes</h2>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Citas</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />No-shows</span>
                <span className="pl-3 border-l border-gray-200">Últimos {a.monthly.length} meses</span>
              </div>
            </div>
            <div className="relative h-48 border-b border-gray-200">
              {[25, 50, 75].map((p) => <div key={p} aria-hidden className="absolute inset-x-0 border-t border-gray-100" style={{ bottom: `${p}%` }} />)}
              <div className="absolute inset-0 flex items-end gap-2 sm:gap-3 px-1">
                {a.monthly.map((v, i) => {
                  const last = i === a.monthly.length - 1;
                  const h = Math.max(3, Math.round((v / maxM) * 160));
                  const ns = a.monthlyNoShows[i] ?? 0;
                  const nh = v > 0 ? Math.round((ns / v) * h) : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${v} citas · ${ns} no-shows`}>
                      <span className={`text-[11px] tabular-nums ${last ? "text-blue-700 font-semibold" : "text-gray-500"}`}>{v}</span>
                      <div className={`w-full rounded-t ${last ? "bg-blue-500" : "bg-blue-200"} flex flex-col justify-end overflow-hidden`} style={{ height: `${h}px` }}>
                        {nh > 0 && <div className={last ? "bg-amber-500" : "bg-amber-300"} style={{ height: `${nh}px` }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3 px-1 mt-1.5">
              {a.months.map((m, i) => <span key={m} className={`flex-1 text-center text-[11px] min-w-0 ${i === a.months.length - 1 ? "text-blue-700 font-semibold" : "text-gray-500"}`}>{MONTHS[Number(m.slice(5, 7)) - 1]}</span>)}
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className={CARD}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Umbrales de candidata a Pro</h2>
              <div className="space-y-2 text-[13px]">
                {([["No-shows en 30 días", a.noShows30d, a.thresholds.noShows30d], ["Citas en 30 días", a.appointments30d, a.thresholds.appointments30d]] as const).map(([label, v, th]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-gray-700">
                      <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center ${v >= th ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{v >= th ? <Check className="w-3 h-3" strokeWidth={3} /> : <Minus className="w-3 h-3" strokeWidth={3} />}</span>{label}
                    </span>
                    <span className="font-semibold text-gray-900 tabular-nums">{v} <span className="font-normal text-gray-400">/ umbral {th}</span></span>
                  </div>
                ))}
              </div>
            </section>
            <section className={CARD}>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Argumento de venta</h2>
              <p className="text-[13px] leading-relaxed text-gray-600">
                {t.plan === "PRO"
                  ? <>La clínica ya tiene el plan Pro: la recuperación automática de no-shows y los avisos previos están activos. Los umbrales son solo informativos.</>
                  : a.candidate
                    ? <>Con el plan Pro, la recuperación automática de no-shows habría contactado a <b className="font-semibold text-gray-900">{a.noShows30d} paciente{a.noShows30d === 1 ? "" : "s"}</b> este mes y los avisos previos reducen las ausencias. Es el momento de ofrecer la prueba de 14 días.</>
                    : <>Todavía no cumple ningún umbral. Cuando el volumen crezca, la recuperación automática de no-shows será el argumento para ofrecer la prueba Pro.</>}
              </p>
            </section>
          </div>
        </div>
      )}

      {tab === "usuarios" && (() => {
        const q = userQ.trim().toLowerCase();
        const activeUsers = t.users.filter((u) => u.active).length;
        const rows = t.users.filter((u) => (userF === "all" || (userF === "active") === u.active) && (!q || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q)));
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2.5"><h2 className="text-sm font-semibold text-gray-900">Equipo de la empresa</h2><span className="text-[13px] text-gray-500">{t.users.length} usuario{t.users.length === 1 ? "" : "s"} · {activeUsers} activo{activeUsers === 1 ? "" : "s"}</span></div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <label className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
                  <input type="search" value={userQ} onChange={(e) => setUserQ(e.target.value)} aria-label="Buscar usuario" placeholder="Buscar por nombre o email" className="h-9 w-60 border border-gray-200 rounded-lg bg-white pl-8 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </label>
                <div role="group" aria-label="Filtrar por estado" className="inline-flex border border-gray-200 rounded-lg overflow-hidden bg-white">
                  {([["all", "Todos"], ["active", "Activos"], ["inactive", "Inactivos"]] as const).map(([k, label], i) => (
                    <button key={k} type="button" aria-pressed={userF === k} onClick={() => setUserF(k)} className={`h-[34px] px-3 text-xs ${i > 0 ? "border-l border-gray-200" : ""} ${userF === k ? "bg-gray-900 text-white font-semibold" : "text-gray-700 font-medium hover:bg-gray-50"}`}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
            <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <DataTable minWidth={760}>
              <table className="w-full text-[13px]">
                <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">{["Usuario", "Rol", "Estado", "Alta", "Último acceso"].map((h, i) => <th key={h} className={`font-semibold px-4 py-2.5 border-b border-gray-200 ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t.users.length === 0 ? "Sin usuarios." : "Ningún usuario coincide con el filtro."}</td></tr> : rows.map((u) => {
                    const r = ROLE_META[u.role] ?? DEFAULT_ROLE;
                    return (
                      <tr key={u.id} className={`border-b border-gray-100 last:border-0 ${u.active ? "" : "text-gray-400"}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span aria-hidden className={`w-[34px] h-[34px] rounded-full inline-flex items-center justify-center text-xs font-semibold shrink-0 ${u.active ? r.avatar : "bg-gray-100 text-gray-400"}`}>{initials(u.firstName, u.lastName)}</span>
                            <span className="flex flex-col min-w-0"><span className={`font-semibold ${u.active ? "text-gray-900" : "text-gray-500"}`}>{u.firstName} {u.lastName}</span><span className={`text-xs truncate ${u.active ? "text-gray-500" : "text-gray-400"}`}>{u.email}</span></span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${u.active ? r.chip : "bg-gray-50 text-gray-400 border-gray-200"}`}><r.Icon className="w-3 h-3" />{r.label}</span></td>
                        <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 font-medium ${u.active ? "text-emerald-700" : "text-gray-500"}`}><span className={`w-2 h-2 rounded-full ${u.active ? "bg-emerald-500" : "bg-gray-300"}`} />{u.active ? "Activo" : "Inactivo"}</span></td>
                        <td className="px-4 py-3 text-gray-500 tabular-nums">{fmtDay(u.createdAt)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{u.active ? fmtRel(u.lastLoginAt) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </DataTable>
            </section>
            {/* Nota: el equipo se edita desde la clínica (el botón de entrar ya está en la cabecera). */}
            <div className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3.5">
              <span aria-hidden className="w-7 h-7 rounded-lg bg-teal-50 text-teal-700 inline-flex items-center justify-center shrink-0"><Users className="w-4 h-4" /></span>
              <p className="text-[13px] text-gray-600 leading-relaxed pt-0.5"><b className="font-semibold text-gray-900">El equipo lo gestiona la propia clínica.</b> Para dar de alta, desactivar o cambiar el rol de un usuario, entra como la empresa y ve a <span className="font-semibold text-gray-900">Configuración → Equipo</span>.</p>
            </div>
          </div>
        );
      })()}

      {tab === "centros" && (() => {
        const centerReq = openReqs.find((r) => r.kind === "CENTER") ?? null;
        const limit = t.maxCenters;
        const atLimit = limit != null && activeCenters >= limit;
        const freeSlots = limit != null ? Math.max(0, limit - activeCenters) : 0;
        return (
          <div className="space-y-4">
            <section className={`${CARD} grid lg:grid-cols-2 gap-6`}>
              <div className="flex flex-col gap-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Centros contratados</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-[28px] leading-none font-semibold text-violet-700 tabular-nums">{activeCenters}</span>
                  <span className="text-sm text-gray-500">{limit == null ? "· sin límite de centros" : `de ${limit}${atLimit ? " · límite alcanzado" : freeSlots === 1 ? " · 1 plaza libre" : ` · ${freeSlots} plazas libres`}`}</span>
                </div>
                <div aria-hidden className="flex gap-1 h-2">
                  {limit == null
                    ? <span className="flex-1 rounded-full bg-violet-600" />
                    : Array.from({ length: Math.max(limit, activeCenters) }, (_, i) => <span key={i} className={`flex-1 rounded-full ${i < activeCenters ? "bg-violet-600" : "bg-gray-200"}`} />)}
                </div>
                <span className="text-xs text-gray-500">El límite de centros se cambia en la pestaña <button type="button" onClick={() => setTab("licencia")} className="font-semibold text-blue-600 hover:underline">Licencia</button>. Se factura plan × centros.</span>
              </div>
              {centerReq ? (
                <div className="flex flex-col gap-2.5 rounded-[10px] bg-violet-50 border border-violet-200 px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-300"><Building2 className="w-3 h-3" />Centro adicional</span>
                    <span className="text-xs text-gray-500 tabular-nums">Pedido el {fmt(centerReq.createdAt)}</span>
                  </div>
                  <p className="text-[13px] text-violet-900 leading-relaxed">La clínica ha pedido <b className="font-semibold">un centro más</b>. Al aprobar, el límite pasa a {(limit ?? activeCenters) + 1} y podrá crearlo desde su panel.</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => approveReq(centerReq)} disabled={decide.isPending} className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-lg bg-violet-700 text-white text-[13px] font-semibold hover:bg-violet-800 disabled:opacity-60"><Check className="w-3.5 h-3.5" strokeWidth={2.5} /> Aprobar · límite {(limit ?? activeCenters) + 1}</button>
                    <button type="button" onClick={() => rejectReq(centerReq)} disabled={decide.isPending} className="h-[34px] px-3.5 rounded-lg border border-red-200 bg-white text-red-600 text-[13px] font-semibold hover:bg-red-50 disabled:opacity-60">Rechazar…</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col justify-center gap-1 rounded-[10px] border border-dashed border-gray-200 px-4 py-3.5 text-[13px] text-gray-500">
                  <span className="font-semibold text-gray-700">Sin peticiones de centro</span>
                  <span>Cuando la clínica llegue al límite verá “Solicitar un centro más” en su pantalla de Centros, y la petición aparecerá aquí.</span>
                </div>
              )}
            </section>

            <div className="flex items-baseline gap-2.5 pt-1"><h2 className="text-sm font-semibold text-gray-900">Centros</h2><span className="text-[13px] text-gray-500">{activeCenters} activo{activeCenters === 1 ? "" : "s"}{t.centers.length > activeCenters ? ` · ${t.centers.length - activeCenters} desactivado${t.centers.length - activeCenters === 1 ? "" : "s"}` : ""}</span></div>
            {t.centers.length === 0 && !atLimit && <p className="text-sm text-gray-400">Sin centros todavía. La clínica los crea desde Administración → Centros.</p>}
            <div className="grid lg:grid-cols-2 gap-4">
              {t.centers.map((c) => (
                <div key={c.id} className={`bg-white border border-gray-200 rounded-xl p-5 flex gap-3.5 ${c.active ? "" : "opacity-60"}`}>
                  <span aria-hidden className={`w-10 h-10 rounded-[10px] inline-flex items-center justify-center shrink-0 ${c.active ? "bg-violet-50 text-violet-700" : "bg-gray-100 text-gray-400"}`}><Building2 className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500"><MapPin className="w-3 h-3" />{c.city || "—"}</span>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ${c.active ? "text-emerald-700" : "text-gray-500"}`}><span className={`w-2 h-2 rounded-full ${c.active ? "bg-emerald-500" : "bg-gray-300"}`} />{c.active ? "Activo" : "Desactivado"}</span>
                    </div>
                    <div className="flex gap-4 flex-wrap pt-2 border-t border-gray-100 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1.5"><LayoutGrid className="w-3 h-3" /><b className="font-semibold text-gray-700 tabular-nums">{c.roomsCount}</b> sala{c.roomsCount === 1 ? "" : "s"}</span>
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3 h-3" /><b className="font-semibold text-gray-700 tabular-nums">{c.appointments30d}</b> citas · 30 d</span>
                      <span>Alta <b className="font-semibold text-gray-700 tabular-nums">{fmtDay(c.createdAt)}</b></span>
                    </div>
                  </div>
                </div>
              ))}
              {limit != null && (atLimit
                ? (
                  <div className="border border-dashed border-gray-300 rounded-xl p-5 flex items-center gap-3.5 text-gray-500">
                    <span aria-hidden className="w-10 h-10 rounded-[10px] border border-dashed border-gray-300 inline-flex items-center justify-center shrink-0 text-gray-400"><Ban className="w-[18px] h-[18px]" /></span>
                    <div className="flex flex-col gap-0.5"><span className="text-[13px] font-semibold text-gray-700">Sin plaza libre</span><span className="text-xs leading-relaxed">La clínica no puede crear más centros hasta que amplíes el límite{centerReq ? " o apruebes su petición" : ""}.</span></div>
                  </div>
                )
                : Array.from({ length: freeSlots }, (_, i) => (
                  <div key={`free-${i}`} className="border border-dashed border-gray-300 rounded-xl p-5 flex items-center gap-3.5 text-gray-500">
                    <span aria-hidden className="w-10 h-10 rounded-[10px] border border-dashed border-gray-300 inline-flex items-center justify-center shrink-0 text-gray-400"><Building2 className="w-[18px] h-[18px]" /></span>
                    <div className="flex flex-col gap-0.5"><span className="text-[13px] font-semibold text-gray-700">Plaza libre</span><span className="text-xs leading-relaxed">La clínica puede crear un centro más sin ampliar el límite.</span></div>
                  </div>
                )))}
            </div>
          </div>
        );
      })()}

      {tab === "auditoria" && (() => {
        const all = [...t.history.map(entryOfHistory), ...t.requests.map(entryOfRequest)].sort((x, y) => y.at.localeCompare(x.at));
        const entries = auditF === "all" ? all : all.filter((e) => e.kind === auditF);
        // Agrupadas por día; "Hoy" para la fecha actual.
        const groups: { day: string; label: string; items: Entry[] }[] = [];
        const todayKey = new Date().toLocaleDateString("es-ES");
        for (const e of entries) {
          const day = new Date(e.at).toLocaleDateString("es-ES");
          const g = groups[groups.length - 1];
          if (g && g.day === day) g.items.push(e); else groups.push({ day, label: `${day === todayKey ? "Hoy · " : ""}${fmtLong(e.at)}`, items: [e] });
        }
        const FILTERS: { k: "all" | EntryKind; label: string; dot?: string; Icon?: LucideIcon }[] = [
          { k: "all", label: "Todo" }, { k: "plan", label: "Plan", dot: "bg-blue-600" }, { k: "prueba", label: "Prueba", dot: "bg-amber-500" }, { k: "centros", label: "Centros", dot: "bg-violet-600" }, { k: "peticion", label: "Peticiones", Icon: Inbox }, { k: "auto", label: "Automático", dot: "bg-gray-400" },
        ];
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2.5"><h2 className="text-sm font-semibold text-gray-900">Historial de la licencia</h2><span className="text-[13px] text-gray-500">{entries.length} entrada{entries.length === 1 ? "" : "s"}</span></div>
              <div role="group" aria-label="Filtrar por tipo" className="inline-flex gap-1.5 flex-wrap">
                {FILTERS.map((f) => (
                  <button key={f.k} type="button" aria-pressed={auditF === f.k} onClick={() => setAuditF(f.k)} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs ${auditF === f.k ? "bg-gray-900 border-gray-900 text-white font-semibold" : "bg-white border-gray-200 text-gray-700 font-medium hover:bg-gray-50"}`}>{f.dot && <span className={`w-2 h-2 rounded-full ${f.dot}`} />}{f.Icon && <f.Icon className="w-3 h-3" />}{f.label}</button>
                ))}
              </div>
            </div>
            <section className="bg-white border border-gray-200 rounded-xl px-6 pt-2 pb-4">
              {groups.length === 0 ? <p className="py-6 text-sm text-gray-400">{all.length === 0 ? "Sin cambios registrados." : "Ninguna entrada de este tipo."}</p> : groups.map((g) => (
                <div key={g.day}>
                  <div className="pt-3.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.label}</div>
                  {g.items.map((e, i) => {
                    const s = e.style ?? KIND_STYLE[e.kind];
                    const lastOfGroup = i === g.items.length - 1;
                    return (
                      <div key={e.id} className="grid grid-cols-[52px_36px_minmax(0,1fr)] gap-x-3 py-2.5">
                        <span className="text-xs text-gray-500 pt-[7px] tabular-nums">{new Date(e.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="flex flex-col items-center gap-1"><span aria-hidden className={`w-[30px] h-[30px] rounded-full inline-flex items-center justify-center shrink-0 ${s.cls}`}><s.Icon className="w-[15px] h-[15px]" /></span>{!lastOfGroup && <span className="flex-1 w-px bg-gray-200" />}</span>
                        <div className={`flex flex-col gap-1.5 ${lastOfGroup ? "" : "pb-2"}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900">{e.title}</span>
                            {e.chip && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${e.chip.cls}`}>{e.chip.label}</span>}
                            {e.auto && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"><Bot className="w-[11px] h-[11px]" />Automático</span>}
                          </div>
                          {e.who && <span className="text-xs text-gray-500">{e.who}</span>}
                          {e.note && <span className="text-xs text-gray-600 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">{e.kind === "peticion" ? e.note : <>Motivo: “{e.note}”</>}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          </div>
        );
      })()}

      {dialogTo && <PlanChangeDialog tenant={{ id: t.id, name: t.name, plan: t.plan, centersCount: activeCenters, openRequests: openReqs.length, adminName: t.admin?.name ?? null }} to={dialogTo} catalog={t.catalog} onClose={() => setDialogTo(null)} onDone={() => setForm(null)} />}
      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// Tarjeta compacta de la columna lateral de Licencia: últimos 6 meses y cifras de 30 días.
function ActivityCard({ a, plan, onMore }: { a: Detail["activity"]; plan: PlanTier; onMore: () => void }) {
  const monthly = a.monthly.slice(-6), months = a.months.slice(-6);
  const maxM = Math.max(...monthly, 1);
  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-gray-900">Actividad</h2><button type="button" onClick={onMore} className="text-xs font-semibold text-blue-600 hover:underline">Ver detalle →</button></div>
      <div className="flex items-end gap-1.5 h-14 mt-3">
        {monthly.map((v, i) => <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full"><div className={`w-full rounded-t ${i === monthly.length - 1 ? "bg-blue-500" : "bg-blue-200"}`} style={{ height: `${Math.max(3, Math.round((v / maxM) * 40))}px` }} title={`${v} citas`} /><span className="text-[10px] text-gray-400">{months[i] ? MONTHS[Number(months[i]!.slice(5, 7)) - 1] : ""}</span></div>)}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div><div className="text-lg font-bold tabular-nums text-blue-600">{a.appointments30d}</div><div className="text-[10px] text-gray-500">citas · 30 d</div></div>
        <div><div className={`text-lg font-bold tabular-nums ${a.noShows30d >= a.thresholds.noShows30d ? "text-amber-700" : "text-gray-800"}`}>{a.noShows30d}</div><div className="text-[10px] text-gray-500">no-shows</div></div>
        <div><div className="text-lg font-bold tabular-nums text-gray-800">{a.lastActivityAt ? fmtDay(a.lastActivityAt) : "—"}</div><div className="text-[10px] text-gray-500">última cita</div></div>
      </div>
      {a.candidate && plan === "ESSENTIAL" && <p className="mt-3 text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5 inline-flex items-start gap-1.5"><Flame className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Candidata a Pro: con {a.noShows30d} no-shows al mes, la recuperación automática se paga sola.</p>}
    </section>
  );
}

// Indicador de la pestaña Actividad: etiqueta, icono con fondo suave y valor (o chip)
// en el color de la lectura (azul citas · ámbar no-shows · verde actividad · naranja candidata).
const TONE = {
  blue: { icon: "bg-blue-50 text-blue-600", value: "text-blue-600" },
  amber: { icon: "bg-amber-50 text-amber-700", value: "text-amber-700" },
  emerald: { icon: "bg-emerald-50 text-emerald-700", value: "text-emerald-700" },
  orange: { icon: "bg-orange-50 text-orange-700", value: "text-orange-700" },
} as const;
function Kpi({ label, Icon, tone, value, sub, small, chip }: { label: string; Icon: LucideIcon; tone: keyof typeof TONE; value?: number | string; sub: string; small?: boolean; chip?: { label: string; cls: string } }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-[18px] py-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <span className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${TONE[tone].icon}`}><Icon className="w-4 h-4" /></span>
      </div>
      {chip
        ? <span className={`self-start inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${chip.cls}`}>{chip.label}</span>
        : <span className={`font-semibold tabular-nums ${small ? "text-xl leading-snug" : "text-[26px] leading-tight"} ${TONE[tone].value}`}>{value}</span>}
      <span className="text-xs text-gray-500">{sub}</span>
    </div>
  );
}
