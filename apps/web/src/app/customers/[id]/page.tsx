"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { DEFAULT_CONSENT_TEXT, renderConsent } from "@/lib/consent";
import { FileText, AlertTriangle, MessageCircle, Mail, Copy, Check, Send, Phone, IdCard, Cake, Flag, MapPin, Building2, CalendarPlus, ShieldCheck, Trash2, Pencil, Stethoscope, UserX, Calendar, AlarmClock, Clock, RefreshCw, BarChart3, MessageSquare, PenLine, X, Car, Target } from "lucide-react";

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dni: string | null;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  nationality: string | null;
  municipality: string | null;
  province: string | null;
  notes: string | null;
  gdprInformedAt: string | null;
  gdprConsentAt: string | null;
  gdprConsentIp: string | null;
  acceptsEmail: boolean;
  acceptsSms: boolean;
  acceptsWhatsapp: boolean;
  consentSignatureKey: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Revision {
  id: string;
  outcome: string;
  expiryDate: string | null;
  completedAt: string | null;
  createdAt: string;
  appointment: { scheduledAt: string; product: { id: string; name: string; type: string } };
  doctor: { id: string; firstName: string; lastName: string } | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  PENDING: "En curso", APTO: "Apto", NO_APTO: "No apto", APTO_CON_RESTRICCIONES: "Apto c/ restricciones",
};
const OUTCOME_COLORS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700", APTO: "bg-green-50 text-green-700",
  NO_APTO: "bg-red-50 text-red-700", APTO_CON_RESTRICCIONES: "bg-blue-50 text-blue-700",
};
// Indicador visual del resultado: icono + color del círculo y del texto.
const OUTCOME_VIZ: Record<string, { icon: typeof Check; circle: string; icon2: string; text: string }> = {
  APTO: { icon: Check, circle: "bg-green-50", icon2: "text-green-700", text: "text-green-700" },
  NO_APTO: { icon: X, circle: "bg-red-50", icon2: "text-red-700", text: "text-red-700" },
  PENDING: { icon: Clock, circle: "bg-amber-50", icon2: "text-amber-700", text: "text-amber-700" },
  APTO_CON_RESTRICCIONES: { icon: ShieldCheck, circle: "bg-blue-50", icon2: "text-blue-700", text: "text-blue-700" },
};
// Nº de renovación (0 = alta inicial). "Primera vez" es la primera registrada en el sistema.
const seqLabel = (i: number) => (i === 0 ? "Primera vez" : `${i}ª renovación`);
const PRODUCT_ICON: Record<string, typeof Car> = { CARNET_CONDUCIR: Car, LICENCIA_ARMAS: Target, DNI: IdCard };
// Estado actual del carnet a partir de su revisión más reciente. Devuelve solo el
// color de texto (sin relleno) para el indicador de la cabecera.
function groupStatus(latest: Revision): { text: string; textCls: string } {
  if (latest.outcome === "PENDING") return { text: "En curso", textCls: "text-amber-600" };
  if (latest.outcome === "NO_APTO") return { text: "No apto en la última", textCls: "text-red-600" };
  if (latest.expiryDate) {
    const b = expiryBadge(latest.expiryDate);
    return { text: b.text, textCls: b.cls.split(" ").find((c) => c.startsWith("text-")) ?? "text-gray-600" };
  }
  return { text: "Apto", textCls: "text-green-700" };
}

type EditForm = {
  dni: string; firstName: string; lastName: string; email: string; phone: string; birthDate: string;
  nationality: string; municipality: string; province: string; notes: string;
};
function toEditForm(c: Customer): EditForm {
  return {
    dni: c.dni ?? "", firstName: c.firstName ?? "", lastName: c.lastName ?? "", email: c.email ?? "", phone: c.phone ?? "",
    birthDate: c.birthDate ? c.birthDate.slice(0, 10) : "", nationality: c.nationality ?? "",
    municipality: c.municipality ?? "", province: c.province ?? "", notes: c.notes ?? "",
  };
}

function editErrorMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (Array.isArray(e) && (e[0] as { message?: string })?.message) return (e[0] as { message: string }).message;
    if (e && typeof e === "object") {
      const msgs = Object.values(e as Record<string, string[]>).flat().filter(Boolean);
      if (msgs.length) return msgs.join(" · ");
    }
  }
  return err instanceof Error ? err.message : "Error al guardar";
}

// Campo de solo-lectura de la ficha: icono + etiqueta atenuada + valor.
function Field({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-400 flex items-center gap-1.5 mb-0.5"><Icon className="w-3.5 h-3.5 shrink-0" /> {label}</p>
      <div className="text-sm text-gray-900 break-words">{children}</div>
    </div>
  );
}
function initialsOf(f?: string | null, l?: string | null): string {
  return (`${(f ?? "").trim()[0] ?? ""}${(l ?? "").trim()[0] ?? ""}`).toUpperCase() || "?";
}
function ageFrom(birth?: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}
function waHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const full = d.startsWith("34") ? d : d.length === 9 ? "34" + d : d;
  return `https://wa.me/${full}`;
}
const dmy = (d: string | Date) => new Date(d).toLocaleDateString("es-ES");

function EditField({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function Toggle({ checked, onChange, label, icon: Icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; icon?: typeof Mail }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white">
      <span className="text-sm text-gray-800 flex items-center gap-2.5">{Icon && <Icon className={`w-4 h-4 ${checked ? "text-emerald-600" : "text-gray-400"}`} />}{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? "bg-blue-600" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

const TABS = ["datos", "historial", "revisiones", "acciones", "rgpd"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { datos: "Datos", historial: "Historial", revisiones: "Revisiones", acciones: "Acciones", rgpd: "RGPD" };

interface TimelineEvent { at: string; kind: string; title: string; detail: string; tone: string }
const TONE_DOT: Record<string, string> = { book: "bg-gray-400", arrive: "bg-yellow-400", clinic: "bg-teal-500", comm: "bg-sky-500", confirm: "bg-emerald-500", reprog: "bg-violet-500", negative: "bg-red-500" };
// Comunicaciones = avisos/notificaciones enviados + respuestas del cliente a ellos.
const COMM_SENT_KINDS = new Set(["confirmacion_solicitada", "recordatorio_renovacion", "recordatorio", "campana"]);
const COMM_RESP_KINDS = new Set(["cliente_confirmo", "cliente_cancelo"]);
const COMM_KINDS = new Set([...COMM_SENT_KINDS, ...COMM_RESP_KINDS]);
function fmtEventDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Acciones comerciales ──────────────────────────────────────────────────────
interface Renewal { productId: string; productName: string; expiryDate: string }
interface CommercialSummary { renewals: Renewal[]; metrics: { revisions: number; noShows: number; lastVisitAt: string | null; contacts: number; lastContactAt: string | null } }
interface ReminderContact { firstName: string | null; phone: string | null; email: string | null; acceptsWhatsapp: boolean; acceptsEmail: boolean }
interface RenewalReminder { url: string; customer: ReminderContact; productName: string; expiryDate: string }

const daysToExpiry = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
function expiryBadge(iso: string): { text: string; cls: string } {
  const d = daysToExpiry(iso);
  if (d < 0) return { text: `vencido hace ${Math.abs(d)} d`, cls: "bg-red-50 text-red-700" };
  if (d <= 30) return { text: `caduca en ${d} d`, cls: "bg-red-50 text-red-700" };
  if (d <= 90) return { text: `caduca en ${d} d`, cls: "bg-amber-50 text-amber-700" };
  return { text: `vigente · ${d} d`, cls: "bg-emerald-50 text-emerald-700" };
}
const fmtShort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");
function waNorm(phone: string): string { const d = phone.replace(/\D/g, ""); if (d.startsWith("34")) return d; if (d.length === 9) return "34" + d; return d; }

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  // Pestaña inicial desde la URL (?tab=rgpd) — permite enlazar directo a una sección.
  const qTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(qTab ?? "") ? (qTab as Tab) : "datos");
  const [commOnly, setCommOnly] = useState(false); // filtro "Solo comunicaciones" del historial
  const [revView, setRevView] = useState<"agrupado" | "cronologico">("cronologico"); // vista de Revisiones
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [revError, setRevError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: customer, isLoading: loadingCustomer } = useQuery<Customer>({
    queryKey: ["customer", id], queryFn: () => apiFetch<Customer>(`/customers/${id}`),
  });
  const { data: revisions, isLoading: loadingRevisions } = useQuery<Revision[]>({
    queryKey: ["customer-revisions", id], queryFn: () => apiFetch<Revision[]>(`/customers/${id}/revisions`),
    enabled: tab === "revisiones",
  });
  const { data: timeline, isLoading: loadingTimeline } = useQuery<TimelineEvent[]>({
    queryKey: ["customer-timeline", id], queryFn: () => apiFetch<TimelineEvent[]>(`/customers/${id}/timeline`),
    enabled: tab === "historial",
  });
  const { data: branding } = useQuery<{ name: string; consentText: string | null }>({
    queryKey: ["branding"], queryFn: () => apiFetch<{ name: string; consentText: string | null }>("/tenants/me/branding"), staleTime: 5 * 60_000,
  });
  const { data: summary, isLoading: loadingSummary } = useQuery<CommercialSummary>({
    queryKey: ["customer-summary", id], queryFn: () => apiFetch<CommercialSummary>(`/customers/${id}/commercial-summary`),
    enabled: tab === "acciones",
  });

  // ── Recordatorio de renovación ────────────────────────────────────────────────
  const [reminder, setReminder] = useState<RenewalReminder | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  async function remind(r: Renewal) {
    setRemindingId(r.productId);
    try {
      const d = await apiFetch<{ url: string; customer: ReminderContact; product: { name: string } }>(
        `/customers/${id}/renewal-link?productId=${r.productId}`, { method: "POST" },
      );
      setReminder({ url: d.url, customer: d.customer, productName: r.productName, expiryDate: r.expiryDate });
      void queryClient.invalidateQueries({ queryKey: ["customer-summary", id] });
    } catch { /* noop */ } finally { setRemindingId(null); }
  }

  // ── RGPD state ──────────────────────────────────────────────────────────────
  const [consents, setConsents] = useState({ acceptsEmail: false, acceptsSms: false, acceptsWhatsapp: false });
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentMsg, setConsentMsg] = useState<string | null>(null);
  const [consentMissing, setConsentMissing] = useState<string[]>([]);
  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (customer) setConsents({ acceptsEmail: customer.acceptsEmail, acceptsSms: customer.acceptsSms, acceptsWhatsapp: customer.acceptsWhatsapp });
  }, [customer]);

  // Firma de consentimiento guardada (carga binaria con token).
  const sigKey = customer?.consentSignatureKey ?? null;
  useEffect(() => {
    if (!sigKey) { setSigUrl(null); return; }
    let revoked = false; let obj: string | null = null;
    void (async () => {
      const res = await fetch(`/api/proxy/customers/${id}/consent-signature`, { headers: authHeaders() });
      if (!res.ok || revoked) return;
      const blob = await res.blob();
      if (revoked) return;
      obj = URL.createObjectURL(blob);
      setSigUrl(obj);
    })();
    return () => { revoked = true; if (obj) URL.revokeObjectURL(obj); };
  }, [sigKey, id]);

  async function saveConsents() {
    setConsentMsg(null);
    // Regla: para guardar el consentimiento hace falta firma + al menos un canal.
    const hasSignature = !!customer?.consentSignatureKey || !(padRef.current?.isEmpty() ?? true);
    const hasChannel = consents.acceptsEmail || consents.acceptsSms || consents.acceptsWhatsapp;
    const miss: string[] = [];
    if (!hasSignature) miss.push("Firma del paciente");
    if (!hasChannel) miss.push("Al menos un medio de comunicación");
    setConsentMissing(miss);
    if (miss.length > 0) return;

    setSavingConsent(true);
    try {
      const blob = await padRef.current?.toBlob();
      if (blob) {
        const fd = new FormData();
        fd.append("file", new File([blob], "firma-consentimiento.png", { type: "image/png" }));
        const res = await fetch(`/api/proxy/customers/${id}/consent-signature`, { method: "POST", headers: authHeaders(), body: fd });
        if (!res.ok) throw new Error("No se pudo guardar la firma");
      }
      await apiFetch(`/customers/${id}/consent`, { method: "PUT", body: JSON.stringify(consents) });
      await queryClient.invalidateQueries({ queryKey: ["customer", id] });
      padRef.current?.clear();
      setConsentMissing([]);
      setConsentMsg("Consentimientos guardados");
      setTimeout(() => setConsentMsg(null), 2500);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.errors)) {
        const err = e.errors[0] as { code?: string; fields?: string[] } | undefined;
        if (err?.code === "CONSENT_INCOMPLETE" && Array.isArray(err.fields)) { setConsentMissing(err.fields); return; }
      }
      setConsentMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSavingConsent(false);
    }
  }

  // ── Datos: edición / borrado ──────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (body: Partial<EditForm> & { birthDate?: string }) => apiFetch(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["customer", id] }); setEditing(false); setEditError(null); },
    onError: (err: unknown) => setEditError(editErrorMsg(err)),
  });
  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["customers"] }); router.push("/customers"); },
  });

  function startEdit() { if (customer) { setEditForm(toEditForm(customer)); setEditing(true); setEditError(null); } }
  function cancelEdit() { setEditing(false); setEditForm(null); setEditError(null); }
  function saveEdit() {
    if (!editForm) return;
    // Misma obligatoriedad que el alta.
    const required: [keyof EditForm, string][] = [
      ["firstName", "Nombre"], ["lastName", "Apellidos"], ["birthDate", "Fecha de nacimiento"],
      ["municipality", "Municipio"], ["province", "Provincia"], ["nationality", "Nacionalidad"],
    ];
    for (const [k, label] of required) {
      if (!editForm[k]?.trim()) { setEditError(`${label} es obligatorio`); return; }
    }
    if (!editForm.email?.trim() && !editForm.phone?.trim()) { setEditError("Indica al menos un email o un teléfono"); return; }
    if (isAdmin && !editForm.dni?.trim()) { setEditError("El DNI es obligatorio"); return; }
    setEditError(null);

    const body: Record<string, string> = {};
    (["firstName", "lastName", "email", "phone", "nationality", "municipality", "province", "notes"] as (keyof EditForm)[])
      .forEach((k) => { if (editForm[k]) body[k] = editForm[k]; });
    if (editForm.birthDate) body["birthDate"] = new Date(editForm.birthDate).toISOString();
    // DNI: solo lo envía un admin y solo si ha cambiado (evita revalidar uno legacy).
    if (isAdmin && editForm.dni && editForm.dni !== (customer?.dni ?? "")) body["dni"] = editForm.dni.trim().toUpperCase();
    updateMutation.mutate(body);
  }
  function setField(key: keyof EditForm) { return (v: string) => setEditForm((f) => f ? { ...f, [key]: v } : f); }

  // Abre el certificado PDF de una revisión en una pestaña nueva (solo aptas),
  // igual que "Ver certificado (PDF)" del detalle de la revisión.
  async function viewCertificate(revId: string) {
    setDownloadingId(revId); setRevError(null);
    try {
      const res = await fetch(`/api/proxy/revisions/${revId}/pdf`, { headers: authHeaders() });
      if (!res.ok) throw new Error("No se pudo generar el certificado");
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "Error al abrir el certificado");
    } finally {
      setDownloadingId(null);
    }
  }

  if (loadingCustomer) return <div className="p-6 text-gray-400 text-sm">Cargando...</div>;
  if (!customer) return <div className="p-6 text-red-500 text-sm">Cliente no encontrado</div>;

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Volver</button>
        <h1 className="text-xl font-semibold text-gray-900">{customer.firstName} {customer.lastName}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* ── Datos ── */}
      {tab === "datos" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {editing && (
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-gray-900">Datos personales</h2>
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="px-3 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50">Cancelar</button>
                <button onClick={saveEdit} disabled={updateMutation.isPending} className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {updateMutation.isPending ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          )}

          {editing && editForm ? (
            <div className="grid grid-cols-2 gap-3">
              {isAdmin && (
                <div className="col-span-2">
                  <EditField label="DNI/NIE" value={editForm.dni} onChange={setField("dni")} required />
                </div>
              )}
              <EditField label="Nombre" value={editForm.firstName} onChange={setField("firstName")} required />
              <EditField label="Apellidos" value={editForm.lastName} onChange={setField("lastName")} required />
              <EditField label="Email" value={editForm.email} onChange={setField("email")} type="email" />
              <EditField label="Teléfono" value={editForm.phone} onChange={setField("phone")} type="tel" />
              <EditField label="Fecha de nacimiento" value={editForm.birthDate} onChange={setField("birthDate")} type="date" required />
              <EditField label="Nacionalidad" value={editForm.nationality} onChange={setField("nationality")} required />
              <EditField label="Municipio" value={editForm.municipality} onChange={setField("municipality")} required />
              <EditField label="Provincia" value={editForm.province} onChange={setField("province")} required />
              <div className="col-span-2"><EditField label="Notas" value={editForm.notes} onChange={setField("notes")} /></div>
              <p className="col-span-2 text-xs text-gray-400">Obligatorio al menos un email o teléfono.</p>
              {editError && <p className="col-span-2 text-sm text-red-600">{editError}</p>}
            </div>
          ) : (
            <>
              {/* Cabecera de identidad */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-lg font-medium shrink-0">{initialsOf(customer.firstName, customer.lastName)}</div>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-gray-900 truncate">{customer.firstName} {customer.lastName}</p>
                    <p className="text-sm text-gray-500 truncate">
                      {[customer.dni ? `DNI ${customer.dni}` : null, ageFrom(customer.birthDate) !== null ? `${ageFrom(customer.birthDate)} años` : null, customer.province].filter(Boolean).join(" · ") || "Sin datos de identidad"}
                    </p>
                  </div>
                </div>
                <button onClick={startEdit} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"><Pencil className="w-3.5 h-3.5" /> Editar</button>
              </div>

              {/* Estado RGPD */}
              <div className="flex flex-wrap gap-2 mt-3.5">
                {customer.gdprInformedAt ? (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" /> RGPD informado · {dmy(customer.gdprInformedAt)}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500"><ShieldCheck className="w-3.5 h-3.5" /> RGPD no informado</span>
                )}
                {customer.gdprConsentAt ? (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700"><Check className="w-3.5 h-3.5" /> Consentimiento firmado</span>
                ) : (
                  <button onClick={() => setTab("rgpd")} title="Ir a RGPD para firmar el consentimiento" className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100"><AlertTriangle className="w-3.5 h-3.5" /> Consentimiento sin firmar</button>
                )}
              </div>

              <div className="h-px bg-gray-100 my-5" />

              {/* Contacto */}
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2.5">Contacto</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 mb-5">
                <Field icon={Mail} label="Email">{customer.email ? <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">{customer.email}</a> : <span className="text-gray-300">—</span>}</Field>
                <Field icon={Phone} label="Teléfono">{customer.phone ? <span className="inline-flex items-center gap-2"><a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a><a href={waHref(customer.phone)} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="text-emerald-600 hover:text-emerald-700"><MessageCircle className="w-3.5 h-3.5" /></a></span> : <span className="text-gray-300">—</span>}</Field>
              </div>

              {/* Identidad */}
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2.5">Identidad</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 mb-5">
                <Field icon={IdCard} label="DNI / NIE">{customer.dni ?? <span className="text-gray-300">—</span>}</Field>
                <Field icon={Cake} label="Fecha de nacimiento">{customer.birthDate ? <>{dmy(customer.birthDate)}{ageFrom(customer.birthDate) !== null && <span className="text-gray-400"> · {ageFrom(customer.birthDate)} años</span>}</> : <span className="text-gray-300">—</span>}</Field>
                <Field icon={Flag} label="Nacionalidad">{customer.nationality ?? <span className="text-gray-300">—</span>}</Field>
              </div>

              {/* Ubicación */}
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2.5">Ubicación</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
                <Field icon={MapPin} label="Municipio">{customer.municipality ?? <span className="text-gray-300">—</span>}</Field>
                <Field icon={Building2} label="Provincia">{customer.province ?? <span className="text-gray-300">—</span>}</Field>
              </div>

              {customer.notes && (
                <div className="mt-5">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Notas</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{customer.notes}</p>
                </div>
              )}

              {/* Alta + eliminar */}
              <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-400 inline-flex items-center gap-1.5"><CalendarPlus className="w-3.5 h-3.5" /> Alta: {dmy(customer.createdAt)} · Actualizado: {dmy(customer.updatedAt)}</span>
                {!confirmDelete && <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /> Eliminar cliente</button>}
              </div>

              {confirmDelete && (
                <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm text-red-800 font-medium mb-1">¿Eliminar este cliente?</p>
                  <p className="text-xs text-red-600 mb-3">Se anonimizarán sus datos personales (RGPD). Las revisiones se conservan para auditoría.</p>
                  <div className="flex gap-2">
                    <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                      {deleteMutation.isPending ? "Eliminando..." : "Confirmar eliminación"}
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Historial (timeline agregado) ── */}
      {tab === "historial" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {(() => {
            const shown = (timeline ?? []).filter((e) => !commOnly || COMM_KINDS.has(e.kind));
            const sentCount = (timeline ?? []).filter((e) => COMM_SENT_KINDS.has(e.kind)).length;
            const respCount = (timeline ?? []).filter((e) => COMM_RESP_KINDS.has(e.kind)).length;
            const respRate = sentCount > 0 ? Math.round((respCount / sentCount) * 100) : null;
            return (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-medium text-gray-900">Historial de actividad</h2>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                      <button onClick={() => setCommOnly(false)} className={`text-xs px-2.5 py-1 rounded-md ${!commOnly ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>Todo</button>
                      <button onClick={() => setCommOnly(true)} className={`text-xs px-2.5 py-1 rounded-md ${commOnly ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>Solo comunicaciones</button>
                    </div>
                    <span className="text-xs text-gray-400">{shown.length} eventos</span>
                  </div>
                </div>

                {/* Contador de comunicaciones de este cliente */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-1.5">
                    <Send className="w-3.5 h-3.5 text-sky-600" />
                    <span className="text-xs text-sky-700">Avisos enviados</span>
                    <span className="text-sm font-semibold text-sky-700">{sentCount}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1.5">
                    <MessageCircle className="w-3.5 h-3.5 text-teal-600" />
                    <span className="text-xs text-teal-700">Tasa de respuesta</span>
                    <span className="text-sm font-semibold text-teal-700">{respRate === null ? "—" : `${respRate}%`}</span>
                    {sentCount > 0 && <span className="text-[11px] text-teal-600">{respCount}/{sentCount}</span>}
                  </div>
                </div>

                {loadingTimeline ? (
                  <p className="text-sm text-gray-400 py-6">Cargando…</p>
                ) : shown.length === 0 ? (
                  <p className="text-sm text-gray-400 py-6 text-center">{commOnly ? "Sin comunicaciones registradas todavía." : "Sin actividad registrada todavía."}</p>
                ) : (
                  <ol className="relative border-l border-gray-200 ml-1.5 space-y-4 py-1">
                    {shown.map((e, i) => (
                      <li key={i} className="ml-5">
                        <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${TONE_DOT[e.tone] ?? "bg-gray-400"}`} />
                        <p className="text-sm font-medium text-gray-900">{e.title}</p>
                        {e.detail && <p className="text-xs text-gray-500 mt-0.5">{e.detail}</p>}
                        <p className="text-[11px] text-gray-400 mt-0.5 capitalize">{fmtEventDate(e.at)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            );
          })()}
          <p className="text-[11px] text-gray-400 mt-4 pt-3 border-t border-gray-100">Reúne reservas, llegadas, revisiones y comunicaciones (avisos manuales, recordatorios automáticos, campañas y las respuestas del cliente).</p>
        </div>
      )}

      {/* ── Revisiones ── */}
      {tab === "revisiones" && (() => {
        const revs = revisions ?? [];
        // Nº de renovación por producto: índice ascendente por fecha (0 = alta inicial).
        const seqMap = new Map<string, number>();
        {
          const byProd = new Map<string, Revision[]>();
          for (const r of revs) { const k = r.appointment.product.id; const arr = byProd.get(k) ?? []; arr.push(r); byProd.set(k, arr); }
          for (const arr of byProd.values()) {
            [...arr].sort((a, b) => +new Date(a.appointment.scheduledAt) - +new Date(b.appointment.scheduledAt)).forEach((r, i) => seqMap.set(r.id, i));
          }
        }
        const seqTag = (rev: Revision, big?: boolean) => {
          const i = seqMap.get(rev.id) ?? 0;
          return <span className={`${big ? "text-xs" : "text-[11px]"} font-medium px-2 py-0.5 rounded-full ${i === 0 ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`} title="Nº de renovación registrada en el sistema">{seqLabel(i)}</span>;
        };
        const renderRow = (rev: Revision, titleNode: React.ReactNode) => {
          const viz = OUTCOME_VIZ[rev.outcome];
          const Icon = viz?.icon ?? FileText;
          const b = rev.expiryDate ? expiryBadge(rev.expiryDate) : null;
          return (
            <div key={rev.id} className="px-5 py-3.5 flex items-center gap-3.5">
              <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${viz?.circle ?? "bg-gray-100"}`}>
                <Icon className={`w-[18px] h-[18px] ${viz?.icon2 ?? "text-gray-500"}`} />
              </span>
              <div className="min-w-0 flex-1">
                {titleNode}
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className={`font-medium ${viz?.text ?? "text-gray-600"}`}>{OUTCOME_LABELS[rev.outcome] ?? rev.outcome}</span>
                  <span className="text-gray-300">·</span>
                  <Calendar className="w-3 h-3" /> {new Date(rev.appointment.scheduledAt).toLocaleDateString("es-ES")}
                  {rev.doctor && <><span className="text-gray-300">·</span><Stethoscope className="w-3 h-3" /> Dr. {rev.doctor.firstName} {rev.doctor.lastName}</>}
                  {rev.expiryDate && <><span className="text-gray-300">·</span> Caduca {new Date(rev.expiryDate).toLocaleDateString("es-ES")} {b && <span className={`px-1.5 py-0.5 rounded-full ${b.cls}`}>{b.text}</span>}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {rev.outcome === "APTO" && (
                  <button onClick={() => void viewCertificate(rev.id)} disabled={downloadingId === rev.id} title="Ver certificado"
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-blue-600 disabled:opacity-50">
                    <FileText size={14} />{downloadingId === rev.id ? "..." : "Certificado"}
                  </button>
                )}
                <Link href={`/revisions/${rev.id}`} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-blue-600 font-medium">Abrir →</Link>
              </div>
            </div>
          );
        };
        // Grupos por producto (más reciente arriba dentro de cada uno).
        const byProd = new Map<string, { product: Revision["appointment"]["product"]; items: Revision[] }>();
        for (const r of revs) { const p = r.appointment.product; const g = byProd.get(p.id) ?? { product: p, items: [] }; g.items.push(r); byProd.set(p.id, g); }
        const groups = [...byProd.values()]
          .map((g) => { const desc = [...g.items].sort((a, b) => +new Date(b.appointment.scheduledAt) - +new Date(a.appointment.scheduledAt)); return { product: g.product, revisions: desc, latest: desc[0]! }; })
          .sort((a, b) => +new Date(b.latest.appointment.scheduledAt) - +new Date(a.latest.appointment.scheduledAt));

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-medium text-gray-900">Historial de revisiones</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {revs.length > 0 && (() => {
                  const n = (o: string) => revs.filter((r) => r.outcome === o).length;
                  const chips = [
                    { c: n("APTO"), label: "aptas", cls: "bg-green-50 text-green-700" },
                    { c: n("APTO_CON_RESTRICCIONES"), label: "c/ restricciones", cls: "bg-blue-50 text-blue-700" },
                    { c: n("NO_APTO"), label: "no aptas", cls: "bg-red-50 text-red-700" },
                    { c: n("PENDING"), label: "en curso", cls: "bg-amber-50 text-amber-700" },
                  ].filter((x) => x.c > 0);
                  return <div className="flex items-center gap-1.5 flex-wrap">{chips.map((x) => <span key={x.label} className={`text-[11px] px-2 py-0.5 rounded-full ${x.cls}`}>{x.c} {x.label}</span>)}</div>;
                })()}
                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setRevView("cronologico")} className={`text-xs px-2.5 py-1 rounded-md ${revView === "cronologico" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>Cronológico</button>
                  <button onClick={() => setRevView("agrupado")} className={`text-xs px-2.5 py-1 rounded-md ${revView === "agrupado" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>Agrupado</button>
                </div>
              </div>
            </div>

            {loadingRevisions && <div className="bg-white rounded-xl border border-gray-200 px-5 py-6 text-gray-400 text-sm">Cargando...</div>}
            {!loadingRevisions && revs.length === 0 && <div className="bg-white rounded-xl border border-gray-200 px-5 py-6 text-gray-400 text-sm text-center">Sin revisiones registradas</div>}
            {revError && <p className="px-1 text-xs text-red-600">{revError}</p>}

            {revs.length > 0 && (revView === "agrupado" ? (
              <div className="space-y-3">
                {groups.map((g) => {
                  const st = groupStatus(g.latest);
                  const PIcon = PRODUCT_ICON[g.product.type] ?? FileText;
                  return (
                    <div key={g.product.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
                        <span className="text-sm font-medium text-gray-800 flex items-center gap-2 min-w-0"><PIcon className="w-4 h-4 text-gray-500 shrink-0" /><span className="truncate">{g.product.name}</span></span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`text-[11px] font-medium ${st.textCls}`}>{st.text}</span>
                          <span className="text-[11px] text-gray-400">{g.revisions.length} {g.revisions.length === 1 ? "revisión" : "revisiones"}</span>
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {g.revisions.map((rev) => renderRow(rev, seqTag(rev)))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="divide-y divide-gray-50">
                  {revs.map((rev) => renderRow(rev,
                    <p className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap"><span className="truncate">{rev.appointment.product.name}</span>{seqTag(rev, true)}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Acciones comerciales ── */}
      {tab === "acciones" && (
        <div className="space-y-5">
          {/* Renovaciones */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2"><RefreshCw className="w-4 h-4 text-blue-500" /> Renovaciones</h2>
              <span className="text-xs text-gray-400">Certificados vigentes por producto</span>
            </div>
            {loadingSummary ? (
              <p className="text-sm text-gray-400 py-4">Cargando…</p>
            ) : !summary?.renewals.length ? (
              <p className="text-sm text-gray-400 py-4">Sin certificados con fecha de caducidad todavía.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {summary.renewals.map((r) => {
                  const b = expiryBadge(r.expiryDate);
                  return (
                    <div key={r.productId} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{r.productName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${b.cls}`}>{b.text}</span>
                          <span className="ml-2">caduca {fmtShort(r.expiryDate)}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => remind(r)}
                        disabled={remindingId === r.productId}
                        className="shrink-0 rounded-lg bg-blue-600 text-white text-xs font-medium px-3 py-2 hover:bg-blue-700 disabled:opacity-50"
                      >
                        {remindingId === r.productId ? "Generando…" : "Recordar renovación"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumen comercial */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-gray-500" /> Resumen comercial</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Revisiones" value={summary ? String(summary.metrics.revisions) : "—"} icon={Stethoscope} tone="blue" />
              <Stat label="No-shows" value={summary ? String(summary.metrics.noShows) : "—"} icon={UserX} tone={summary && summary.metrics.noShows > 0 ? "red" : "neutral"} />
              <Stat label="Última visita" value={fmtShort(summary?.metrics.lastVisitAt ?? null)} icon={Calendar} tone="neutral" />
              <Stat label="Próxima caducidad" value={summary?.renewals[0] ? fmtShort(summary.renewals[0].expiryDate) : "—"} icon={AlarmClock} tone={summary?.renewals[0] ? "amber" : "neutral"} />
              <Stat label="Contactos" value={summary ? String(summary.metrics.contacts) : "—"} icon={Send} tone="teal" />
              <Stat label="Último contacto" value={fmtShort(summary?.metrics.lastContactAt ?? null)} icon={Clock} tone="neutral" />
            </div>
            {customer && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">Consentimiento de contacto</p>
                  <button onClick={() => setTab("rgpd")} className="text-xs text-blue-600 hover:underline">Editar en RGPD</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConsentBadge on={customer.acceptsWhatsapp} label="WhatsApp" icon={MessageCircle} />
                  <ConsentBadge on={customer.acceptsEmail} label="Email" icon={Mail} />
                  <ConsentBadge on={customer.acceptsSms} label="SMS" icon={MessageSquare} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {reminder && <RenewalReminderModal data={reminder} onClose={() => setReminder(null)} />}

      {/* ── RGPD ── */}
      {tab === "rgpd" && (
        <div className="space-y-5">
          {/* Estado RGPD */}
          <div className="flex flex-wrap gap-2">
            {customer.gdprInformedAt ? (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" /> RGPD informado · {dmy(customer.gdprInformedAt)}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500"><ShieldCheck className="w-3.5 h-3.5" /> RGPD no informado</span>
            )}
            {customer.gdprConsentAt ? (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700"><Check className="w-3.5 h-3.5" /> Consentimiento firmado</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Consentimiento sin firmar</span>
            )}
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Información sobre protección de datos</p>
            <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">
              {renderConsent(branding?.consentText || DEFAULT_CONSENT_TEXT, branding?.name)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2.5 flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Canales de comunicación aceptados</p>
            <div className="space-y-2.5">
              <Toggle icon={MessageCircle} label="WhatsApp" checked={consents.acceptsWhatsapp} onChange={(v) => { setConsents((c) => ({ ...c, acceptsWhatsapp: v })); setConsentMissing([]); }} />
              <Toggle icon={Mail} label="Email" checked={consents.acceptsEmail} onChange={(v) => { setConsents((c) => ({ ...c, acceptsEmail: v })); setConsentMissing([]); }} />
              <Toggle icon={MessageSquare} label="SMS" checked={consents.acceptsSms} onChange={(v) => { setConsents((c) => ({ ...c, acceptsSms: v })); setConsentMissing([]); }} />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-900 mb-1 flex items-center gap-2"><PenLine className="w-4 h-4 text-gray-500" /> Firma del paciente</p>
            <p className="text-xs text-gray-400 mb-2">
              {customer.gdprConsentAt
                ? `Consentimiento registrado el ${new Date(customer.gdprConsentAt).toLocaleDateString("es-ES")}${customer.gdprConsentIp ? ` · desde ${customer.gdprConsentIp}` : ""}`
                : "Consentimiento no registrado"}
            </p>
            {sigUrl && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Firma registrada:</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigUrl} alt="Firma registrada" className="w-64 border border-gray-200 rounded-lg bg-white" />
              </div>
            )}
            <p className="text-xs text-gray-500 mb-1">{sigUrl ? "Firme de nuevo para reemplazarla:" : "Firme aquí con el ratón o el dedo:"}</p>
            <SignaturePad ref={padRef} />
          </div>

          {consentMissing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-medium text-amber-800 mb-1">Para guardar el consentimiento falta:</p>
              <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                {consentMissing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={saveConsents} disabled={savingConsent}
              className="px-4 py-2.5 text-sm rounded-lg bg-gray-900 text-white font-medium hover:bg-black disabled:opacity-50">
              {savingConsent ? "Guardando..." : "Guardar consentimientos"}
            </button>
            {consentMsg && <span className="text-sm text-gray-500">{consentMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

type StatTone = "neutral" | "blue" | "red" | "amber" | "teal";
const STAT_TONES: Record<StatTone, { bg: string; label: string; value: string; icon: string }> = {
  neutral: { bg: "bg-gray-50 border-gray-100", label: "text-gray-400", value: "text-gray-800", icon: "text-gray-400" },
  blue: { bg: "bg-blue-50 border-blue-100", label: "text-blue-600", value: "text-blue-700", icon: "text-blue-500" },
  red: { bg: "bg-red-50 border-red-100", label: "text-red-600", value: "text-red-700", icon: "text-red-500" },
  amber: { bg: "bg-amber-50 border-amber-100", label: "text-amber-600", value: "text-amber-700", icon: "text-amber-500" },
  teal: { bg: "bg-teal-50 border-teal-100", label: "text-teal-700", value: "text-teal-700", icon: "text-teal-600" },
};
function Stat({ label, value, icon: Icon, tone = "neutral" }: { label: string; value: string; icon?: typeof Mail; tone?: StatTone }) {
  const t = STAT_TONES[tone];
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${t.bg}`}>
      <p className={`text-[11px] uppercase tracking-wide flex items-center justify-between ${t.label}`}>
        {label}{Icon && <Icon className={`w-3.5 h-3.5 ${t.icon}`} />}
      </p>
      <p className={`text-sm font-semibold mt-0.5 ${t.value}`}>{value}</p>
    </div>
  );
}

function ConsentBadge({ on, label, icon: Icon }: { on: boolean; label: string; icon: typeof Mail }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

// Modal para enviar el recordatorio de renovación por el canal permitido.
function RenewalReminderModal({ data, onClose }: { data: RenewalReminder; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const name = data.customer.firstName ?? "";
  const base = `Hola ${name}, su certificado de ${data.productName} caduca el ${fmtShort(data.expiryDate)}. Puede renovarlo reservando`;
  const msg = `${base} aquí: ${data.url}`; // mensaje enviado/copiado (con enlace)
  const preview = `${base} desde el enlace.`; // vista previa sin el enlace crudo (no desborda)
  const waHref = data.customer.phone ? `https://wa.me/${waNorm(data.customer.phone)}?text=${encodeURIComponent(msg)}` : null;
  const mailHref = data.customer.email
    ? `mailto:${data.customer.email}?subject=${encodeURIComponent(`Renovación de ${data.productName}`)}&body=${encodeURIComponent(msg)}`
    : null;

  async function copy() {
    try { await navigator.clipboard.writeText(data.url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* noop */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">Recordar renovación</h3>
        <p className="text-xs text-gray-500 mt-1">{data.productName} · caduca {fmtShort(data.expiryDate)}</p>

        <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 break-words">{preview}</div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <a
            href={waHref ?? undefined}
            target="_blank" rel="noreferrer"
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${waHref && data.customer.acceptsWhatsapp ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-100 text-gray-400 pointer-events-none"}`}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
            {!data.customer.acceptsWhatsapp && <span className="text-[11px]">(sin consentimiento)</span>}
            {data.customer.acceptsWhatsapp && !data.customer.phone && <span className="text-[11px]">(sin teléfono)</span>}
          </a>
          <a
            href={mailHref ?? undefined}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${mailHref && data.customer.acceptsEmail ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-100 text-gray-400 pointer-events-none"}`}
          >
            <Mail className="h-4 w-4" /> Email
            {!data.customer.acceptsEmail && <span className="text-[11px]">(sin consentimiento)</span>}
            {data.customer.acceptsEmail && !data.customer.email && <span className="text-[11px]">(sin email)</span>}
          </a>
          <button onClick={copy} className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? "Enlace copiado ✓" : "Copiar enlace"}
          </button>
        </div>

        <button onClick={onClose} className="mt-3 w-full rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">Cerrar</button>
      </div>
    </div>
  );
}
