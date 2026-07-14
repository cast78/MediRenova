"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, authHeaders } from "@/lib/api";
import { DEFAULT_CONSENT_TEXT, renderConsent } from "@/lib/consent";
import { Building2, Palette, CalendarClock, MessagesSquare, ShieldCheck, Code2, History, MessageCircle, Mail, MessageSquare, CheckCircle2, AlertTriangle, KeyRound, Lock, PlugZap, Loader2, Upload, Trash2, Download, Search, UserCircle } from "lucide-react";

type ChannelState = "connected" | "pending" | "off";
interface ChannelStatus {
  whatsapp: { status: ChannelState; detail: string };
  email: { status: ChannelState; from: string | null; detail: string };
  sms: { status: ChannelState; detail: string };
}

interface TenantConfig {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  timezone: string;
  defaultSlotDuration: number;
  bookingGranularity: number;
  maxAppointmentsPerDay: number | null;
  metaWaPhoneNumberId: string | null;
  hasMetaWaToken: boolean;
  dataRetentionMonths: number | null;
  minBookingLeadHours: number | null;
  cancellationWindowHours: number | null;
  noShowGraceMinutes: number | null;
  consentText: string | null;
  waitAmberMinutes: number | null;
  waitRedMinutes: number | null;
}
interface TenantMe { name: string; slug: string; legalName: string | null; taxId: string | null; billingAddress: string | null; config: TenantConfig | null }
interface EmpresaForm { name: string; legalName: string; taxId: string; billingAddress: string }
interface ApiKey { id: string; name: string; prefix: string; active: boolean; createdAt: string; revokedAt: string | null }

interface ConfigForm {
  timezone: string; defaultSlotDuration: string; bookingGranularity: string; maxAppointmentsPerDay: string;
  primaryColor: string; secondaryColor: string; logoUrl: string;
  metaWaPhoneNumberId: string; metaWaAccessToken: string;
  dataRetentionMonths: string;
  minBookingLeadHours: string; cancellationWindowHours: string; noShowGraceMinutes: string;
  consentText: string;
  waitAmberMinutes: string; waitRedMinutes: string;
}

const TABS = [
  { key: "empresa", label: "Empresa", icon: Building2 },
  { key: "marca", label: "Marca", icon: Palette },
  { key: "reservas", label: "Reservas", icon: CalendarClock },
  { key: "comunicaciones", label: "Comunicaciones", icon: MessagesSquare },
  { key: "rgpd", label: "RGPD", icon: ShieldCheck },
  { key: "api", label: "API", icon: Code2 },
  { key: "auditoria", label: "Auditoría", icon: History },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TIMEZONES = ["Europe/Madrid", "Atlantic/Canary"];

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (Array.isArray(e) && e[0]?.message) return e[0].message;
    if (e && typeof e === "object") {
      const msgs = Object.values(e as Record<string, string[]>).flat().filter(Boolean);
      if (msgs.length) return msgs.join(" · ");
    }
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : "Error";
}

const FIELD = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const CARD = "bg-white rounded-xl border border-gray-200 p-5";

// ── API Keys ─────────────────────────────────────────────────────────────────

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const { data: keys } = useQuery<ApiKey[]>({ queryKey: ["api-keys"], queryFn: () => apiFetch<ApiKey[]>("/tenants/me/api-keys") });
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiFetch<{ key: string }>("/tenants/me/api-keys", { method: "POST", body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: (data) => { setNewKey(data.key); setName(""); void queryClient.invalidateQueries({ queryKey: ["api-keys"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/tenants/me/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const active = (keys ?? []).filter((k) => !k.revokedAt);

  return (
    <section className={CARD}>
      <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><KeyRound className="w-4 h-4 text-gray-400" />API Keys</h2>
      <p className="text-sm text-gray-500 mb-4">Claves para la API pública. La clave completa solo se muestra al crearla.</p>

      {newKey && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <p className="text-xs text-amber-700 font-medium mb-1">Copia esta clave ahora — no se volverá a mostrar:</p>
          <code className="block text-xs font-mono break-all bg-white border border-amber-200 rounded px-2 py-1">{newKey}</code>
          <button onClick={() => { void navigator.clipboard.writeText(newKey); }} className="mt-2 text-xs text-amber-700 hover:underline">Copiar</button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la clave (ej: Integración web)" className={`${FIELD} flex-1`} />
        <button onClick={() => create.mutate()} disabled={name.trim().length < 2 || create.isPending}
          className="shrink-0 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium">+ Crear</button>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-gray-400">Sin claves activas.</p>
      ) : (
        <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
          {active.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{k.name}</p>
                <p className="text-xs text-gray-400 font-mono">{k.prefix}… · {new Date(k.createdAt).toLocaleDateString("es-ES")}</p>
              </div>
              <button onClick={() => revoke.mutate(k.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-500">Revocar</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Auditoría ─────────────────────────────────────────────────────────────────

interface AuditUser { id: string; firstName: string; lastName: string; email: string }
interface AuditRow { id: string; action: "CREATE" | "UPDATE" | "DELETE"; resourceType: string; resourceId: string; ipAddress: string | null; createdAt: string; user: AuditUser | null }
interface AuditResp { data: AuditRow[]; meta: { page: number; total: number; pages: number }; resourceTypes: string[] }
interface SimpleUser { id: string; firstName: string; lastName: string }

const ACTION_META: Record<string, { label: string; cls: string }> = {
  CREATE: { label: "Creó", cls: "bg-emerald-50 text-emerald-700" },
  UPDATE: { label: "Editó", cls: "bg-blue-50 text-blue-700" },
  DELETE: { label: "Eliminó", cls: "bg-red-50 text-red-700" },
};
const RES_LABEL: Record<string, string> = {
  appointment: "Reserva", visit: "Visita", revision: "Revisión", customer: "Cliente",
  product: "Producto", center: "Centro", room: "Sala", user: "Usuario", doctor: "Médico",
  campaign: "Campaña", segment: "Segmento", form: "Formulario",
};
const resLabel = (t: string) => RES_LABEL[t] ?? t;

function AuditSection() {
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [action, resourceType, userId, from, to]);

  const { data: users } = useQuery<SimpleUser[]>({ queryKey: ["users"], queryFn: () => apiFetch<SimpleUser[]>("/users") });
  const { data: audit, isLoading } = useQuery<AuditResp>({
    queryKey: ["audit", action, resourceType, userId, from, to, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "25" });
      if (action) p.set("action", action);
      if (resourceType) p.set("resourceType", resourceType);
      if (userId) p.set("userId", userId);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return apiFetch<AuditResp>(`/tenants/me/audit?${p.toString()}`, { raw: true });
    },
  });
  const rows = audit?.data ?? [];
  const types = audit?.resourceTypes ?? [];
  const hasFilters = action || resourceType || userId || from || to;

  return (
    <section className={CARD}>
      <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><History className="w-4 h-4 text-gray-400" />Registro de auditoría</h2>
      <p className="text-sm text-gray-500 mb-4">Quién hizo qué y cuándo. Solo lectura.</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={action} onChange={(e) => setAction(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
          <option value="">Toda acción</option>
          <option value="CREATE">Creó</option>
          <option value="UPDATE">Editó</option>
          <option value="DELETE">Eliminó</option>
        </select>
        <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
          <option value="">Todo recurso</option>
          {types.map((t) => <option key={t} value={t}>{resLabel(t)}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
          <option value="">Todo usuario</option>
          {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        {hasFilters && <button onClick={() => { setAction(""); setResourceType(""); setUserId(""); setFrom(""); setTo(""); }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Limpiar</button>}
      </div>

      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wide">Fecha</th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wide">Usuario</th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wide">Acción</th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wide">Recurso</th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wide hidden sm:table-cell">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Cargando…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Sin registros para este filtro</td></tr>}
            {rows.map((r) => {
              const a = ACTION_META[r.action] ?? { label: r.action, cls: "bg-gray-100 text-gray-600" };
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-3 py-2 text-gray-800">{r.user ? `${r.user.firstName} ${r.user.lastName}` : <span className="text-gray-400">Sistema</span>}</td>
                  <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded font-medium ${a.cls}`}>{a.label}</span></td>
                  <td className="px-3 py-2 text-gray-700">{resLabel(r.resourceType)} <span className="text-gray-300 font-mono text-[11px]">#{r.resourceId.slice(0, 6)}</span></td>
                  <td className="px-3 py-2 text-gray-400 font-mono text-xs hidden sm:table-cell">{r.ipAddress ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {audit && audit.meta.total > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
            <span>{audit.meta.total} registros{audit.meta.pages > 1 ? ` · página ${audit.meta.page} de ${audit.meta.pages}` : ""}</span>
            {audit.meta.pages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2.5 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
                <button onClick={() => setPage((p) => Math.min(audit.meta.pages, p + 1))} disabled={page >= audit.meta.pages} className="px-2.5 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente →</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ── RGPD: herramientas de datos por cliente ───────────────────────────────────

interface RgpdCustomer { id: string; firstName: string | null; lastName: string | null; email: string | null }

function RgpdTools() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const { data: found } = useQuery<{ data: RgpdCustomer[] }>({
    queryKey: ["rgpd-search", dq],
    queryFn: () => apiFetch<{ data: RgpdCustomer[] }>(`/customers?q=${encodeURIComponent(dq)}&limit=8`, { raw: true }),
    enabled: dq.length >= 2,
  });
  const rows = found?.data ?? [];

  async function exportCustomer(c: RgpdCustomer) {
    setBusy(c.id);
    try {
      const res = await apiFetch<unknown>(`/customers/${c.id}/export`);
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rgpd-${(c.lastName ?? c.firstName ?? c.id).toLowerCase().replace(/\s+/g, "-")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setBusy(null); }
  }

  return (
    <section className={CARD}>
      <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Download className="w-4 h-4 text-gray-400" />Datos de un cliente (RGPD)</h2>
      <p className="text-sm text-gray-500 mb-4">Derecho de acceso/portabilidad: exporta todos los datos de un cliente (personales, citas, revisiones e historial) en un archivo.</p>
      <div className="relative w-full max-w-sm mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre, email o DNI…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {dq.length >= 2 && (
        <div className="border border-gray-100 rounded-lg divide-y divide-gray-50">
          {rows.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400">Sin resultados</p>
          ) : rows.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 gap-3">
              <span className="inline-flex items-center gap-2 min-w-0">
                <UserCircle className="w-4 h-4 text-gray-300 shrink-0" />
                <span className="text-sm text-gray-800 truncate">{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre"}</span>
                {c.email && <span className="text-xs text-gray-400 truncate hidden sm:inline">· {c.email}</span>}
              </span>
              <button onClick={() => void exportCustomer(c)} disabled={busy === c.id}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 shrink-0">
                {busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}Exportar
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-3">El borrado / anonimización (derecho al olvido) se gestiona desde la ficha del cliente.</p>
    </section>
  );
}

// ── Tarjeta de canal (Comunicaciones) ─────────────────────────────────────────

function ChannelCard({ icon: Icon, name, sub, status, children }: {
  icon: typeof Mail; name: string; sub: string;
  status: "connected" | "pending" | "off"; children: React.ReactNode;
}) {
  const tone = status === "connected"
    ? { circle: "bg-emerald-50 text-emerald-600", pill: "bg-emerald-50 text-emerald-700", label: "Conectado", dot: true }
    : status === "pending"
      ? { circle: "bg-amber-50 text-amber-600", pill: "bg-amber-50 text-amber-700", label: "Pendiente", dot: false }
      : { circle: "bg-gray-100 text-gray-400", pill: "bg-gray-100 text-gray-500 border border-gray-200", label: "No configurado", dot: false };
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone.circle}`}><Icon className="w-[18px] h-[18px]" /></span>
          <div>
            <p className="text-sm font-medium text-gray-900 leading-tight">{name}</p>
            <p className="text-[11px] text-gray-400">{sub}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${tone.pill}`}>
          {tone.dot ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> : status === "pending" ? <AlertTriangle className="w-3 h-3" /> : null}
          {tone.label}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qTab = searchParams.get("tab");
  const initialTab: TabKey = TABS.some((t) => t.key === qTab) ? (qTab as TabKey) : "empresa";
  const [tab, setTab] = useState<TabKey>(initialTab);

  const { data: tenant } = useQuery<TenantMe>({ queryKey: ["tenant-me"], queryFn: () => apiFetch<TenantMe>("/tenants/me") });
  const [form, setForm] = useState<ConfigForm | null>(null);
  const [replacingToken, setReplacingToken] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "empresa") p.set("tab", tab);
    router.replace(`/settings${p.toString() ? `?${p.toString()}` : ""}`, { scroll: false });
  }, [tab, router]);

  useEffect(() => {
    const c = tenant?.config;
    if (c && !form) {
      setForm({
        timezone: c.timezone, defaultSlotDuration: String(c.defaultSlotDuration), bookingGranularity: String(c.bookingGranularity),
        maxAppointmentsPerDay: c.maxAppointmentsPerDay != null ? String(c.maxAppointmentsPerDay) : "",
        primaryColor: c.primaryColor, secondaryColor: c.secondaryColor, logoUrl: c.logoUrl ?? "",
        metaWaPhoneNumberId: c.metaWaPhoneNumberId ?? "", metaWaAccessToken: "",
        dataRetentionMonths: c.dataRetentionMonths != null ? String(c.dataRetentionMonths) : "",
        minBookingLeadHours: c.minBookingLeadHours != null ? String(c.minBookingLeadHours) : "",
        cancellationWindowHours: c.cancellationWindowHours != null ? String(c.cancellationWindowHours) : "",
        noShowGraceMinutes: c.noShowGraceMinutes != null ? String(c.noShowGraceMinutes) : "",
        consentText: c.consentText ?? DEFAULT_CONSENT_TEXT,
        waitAmberMinutes: c.waitAmberMinutes != null ? String(c.waitAmberMinutes) : "",
        waitRedMinutes: c.waitRedMinutes != null ? String(c.waitRedMinutes) : "",
      });
    }
  }, [tenant, form]);

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const body: Record<string, unknown> = {
        timezone: f.timezone,
        defaultSlotDuration: parseInt(f.defaultSlotDuration, 10),
        bookingGranularity: parseInt(f.bookingGranularity, 10),
        primaryColor: f.primaryColor,
        secondaryColor: f.secondaryColor,
        metaWaPhoneNumberId: f.metaWaPhoneNumberId.trim(),
      };
      if (f.maxAppointmentsPerDay) body["maxAppointmentsPerDay"] = parseInt(f.maxAppointmentsPerDay, 10);
      body["logoUrl"] = f.logoUrl.trim() || null; // vacío = quitar logo
      body["dataRetentionMonths"] = f.dataRetentionMonths ? parseInt(f.dataRetentionMonths, 10) : null;
      body["minBookingLeadHours"] = f.minBookingLeadHours ? parseInt(f.minBookingLeadHours, 10) : null;
      body["cancellationWindowHours"] = f.cancellationWindowHours ? parseInt(f.cancellationWindowHours, 10) : null;
      body["noShowGraceMinutes"] = f.noShowGraceMinutes ? parseInt(f.noShowGraceMinutes, 10) : null;
      body["consentText"] = f.consentText.trim() || null;
      body["waitAmberMinutes"] = f.waitAmberMinutes ? parseInt(f.waitAmberMinutes, 10) : null;
      body["waitRedMinutes"] = f.waitRedMinutes ? parseInt(f.waitRedMinutes, 10) : null;
      // El token solo se envía si el usuario escribió uno nuevo (nunca se borra sin querer).
      if (f.metaWaAccessToken.trim()) body["metaWaAccessToken"] = f.metaWaAccessToken.trim();
      return apiFetch("/tenants/me/config", { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setMsg("Cambios guardados"); setError(null); setReplacingToken(false);
      setForm((f) => (f ? { ...f, metaWaAccessToken: "" } : f));
      setTimeout(() => setMsg(null), 2500);
      void queryClient.invalidateQueries({ queryKey: ["tenant-me"] });
    },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  function set<K extends keyof ConfigForm>(key: K, val: ConfigForm[K]) {
    setForm((f) => (f ? { ...f, [key]: val } : f));
  }

  // Datos de empresa (viven en el tenant, no en el config).
  const [empresa, setEmpresa] = useState<EmpresaForm | null>(null);
  useEffect(() => {
    if (tenant && !empresa) setEmpresa({ name: tenant.name, legalName: tenant.legalName ?? "", taxId: tenant.taxId ?? "", billingAddress: tenant.billingAddress ?? "" });
  }, [tenant, empresa]);
  const saveEmpresa = useMutation({
    mutationFn: () => apiFetch("/tenants/me", { method: "PATCH", body: JSON.stringify({ name: empresa!.name, legalName: empresa!.legalName || null, taxId: empresa!.taxId || null, billingAddress: empresa!.billingAddress || null }) }),
    onSuccess: () => { setMsg("Cambios guardados"); setError(null); setTimeout(() => setMsg(null), 2500); void queryClient.invalidateQueries({ queryKey: ["tenant-me"] }); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  // Subida de logo (se guarda como data URL, sirve directo en <img>).
  const [logoBusy, setLogoBusy] = useState(false);
  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/proxy/tenants/me/logo", { method: "POST", headers: authHeaders(), body: fd });
      if (!res.ok) { setError("No se pudo subir el logo (PNG/JPG/WEBP, máx 256 KB)"); return; }
      const json = await res.json();
      set("logoUrl", json.data.logoUrl as string);
      void queryClient.invalidateQueries({ queryKey: ["tenant-me"] });
      void queryClient.invalidateQueries({ queryKey: ["branding"] });
    } finally { setLogoBusy(false); }
  }

  const cfg = tenant?.config ?? null;

  // Estado real de los canales + "Probar conexión".
  const { data: channels } = useQuery<ChannelStatus>({
    queryKey: ["channels"],
    queryFn: () => apiFetch<ChannelStatus>("/tenants/me/channels"),
    enabled: tab === "comunicaciones",
  });
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const test = useMutation({
    mutationFn: (ch: string) => apiFetch<{ ok: boolean; message: string }>(`/tenants/me/channels/${ch}/test`, { method: "POST" }),
    onSuccess: (r, ch) => setTestResult((s) => ({ ...s, [ch]: r })),
    onError: (_e, ch) => setTestResult((s) => ({ ...s, [ch]: { ok: false, message: "No se pudo probar la conexión." } })),
  });

  // Botón "Probar conexión" + resultado por canal.
  function TestRow({ ch }: { ch: string }) {
    const r = testResult[ch];
    const busy = test.isPending && test.variables === ch;
    return (
      <div className="flex items-center gap-2.5 flex-wrap border-t border-gray-100 pt-3 mt-1">
        <button type="button" onClick={() => test.mutate(ch)} disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}Probar conexión
        </button>
        {r && (
          <span className={`text-xs inline-flex items-center gap-1 ${r.ok ? "text-emerald-600" : "text-amber-600"}`}>
            {r.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{r.message}
          </span>
        )}
      </div>
    );
  }

  // Barra de guardado reutilizable para las pestañas de config.
  const SaveBar = () => (
    <div className="flex items-center justify-end gap-3">
      {msg && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{msg}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50">
        {save.isPending ? "Guardando…" : "Guardar cambios"}
      </button>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Configuración</h1>
        <p className="text-sm text-gray-500 mt-0.5">{tenant?.name}{tenant?.slug ? ` · ${tenant.slug}` : ""}</p>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium transition-colors whitespace-nowrap ${tab === t.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {/* Empresa */}
      {tab === "empresa" && empresa && (
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-4">Datos de la empresa</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre comercial</label>
                <input value={empresa.name} onChange={(e) => setEmpresa((s) => (s ? { ...s, name: e.target.value } : s))} className={FIELD} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Identificador</label>
                <input value={tenant?.slug ?? ""} disabled className={`${FIELD} bg-gray-50 text-gray-500 font-mono`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Razón social</label>
                <input value={empresa.legalName} onChange={(e) => setEmpresa((s) => (s ? { ...s, legalName: e.target.value } : s))} placeholder="Clínica Demo S.L." className={FIELD} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CIF / NIF</label>
                <input value={empresa.taxId} onChange={(e) => setEmpresa((s) => (s ? { ...s, taxId: e.target.value } : s))} placeholder="B12345678" className={FIELD} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Dirección de facturación</label>
                <input value={empresa.billingAddress} onChange={(e) => setEmpresa((s) => (s ? { ...s, billingAddress: e.target.value } : s))} placeholder="Calle…, CP, Ciudad" className={FIELD} />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Se usa como entidad emisora en certificados y facturación.</p>
          </section>
          <div className="flex items-center justify-end gap-3">
            {msg && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{msg}</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button onClick={() => saveEmpresa.mutate()} disabled={saveEmpresa.isPending}
              className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50">
              {saveEmpresa.isPending ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}

      {/* Marca */}
      {tab === "marca" && form && (
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-4">Marca</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Color primario</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
                  <input value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className={`${FIELD} font-mono`} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Color secundario</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
                  <input value={form.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} className={`${FIELD} font-mono`} />
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Logo</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 min-w-[120px] h-[52px] flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {form.logoUrl ? <img src={form.logoUrl} alt="logo" className="h-8 max-w-[120px] object-contain" /> : <span className="text-xs text-gray-400">Sin logo</span>}
                  </div>
                  <label className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 cursor-pointer inline-flex items-center gap-1.5">
                    {logoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}Subir logo
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  {form.logoUrl && (
                    <button type="button" onClick={() => set("logoUrl", "")} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />Quitar</button>
                  )}
                </div>
                <div className="mt-2">
                  <label className="block text-[11px] text-gray-400 mb-1">…o pega una URL externa</label>
                  <input value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" className={FIELD} />
                </div>
              </div>
            </div>
          </section>

          {/* Vista previa en vivo */}
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-3">Vista previa</h2>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100" style={{ backgroundColor: `${form.primaryColor}0d` }}>
                {form.logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={form.logoUrl} alt="logo" className="h-7 max-w-[140px] object-contain" />
                  : <span className="text-sm font-semibold" style={{ color: form.primaryColor }}>{tenant?.name}</span>}
                <span className="text-xs" style={{ color: form.secondaryColor }}>Reserva tu cita</span>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-700">Selecciona un hueco para tu revisión médica.</p>
                <div className="flex items-center gap-2">
                  <button type="button" className="px-4 py-2 text-sm rounded-lg text-white font-medium" style={{ backgroundColor: form.primaryColor }}>Reservar cita</button>
                  <button type="button" className="px-4 py-2 text-sm rounded-lg font-medium border" style={{ color: form.secondaryColor, borderColor: form.secondaryColor }}>Ver disponibilidad</button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Así se verán tus colores y logo en la página pública de reserva y en los certificados.</p>
          </section>

          <SaveBar />
        </div>
      )}

      {/* Reservas */}
      {tab === "reservas" && form && (
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-4">Reservas y agenda</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Granularidad de huecos</label>
                <select value={form.bookingGranularity} onChange={(e) => set("bookingGranularity", e.target.value)} className={FIELD}>
                  {["10", "15", "20", "30"].map((g) => <option key={g} value={g}>{g} min</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Cada cuánto se ofrecen los huecos de reserva</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duración por defecto (min)</label>
                <input type="number" min={5} max={120} step={5} value={form.defaultSlotDuration} onChange={(e) => set("defaultSlotDuration", e.target.value)} className={FIELD} />
                <p className="text-[11px] text-gray-400 mt-1">Si el producto no define duración</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Zona horaria</label>
                <select value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className={FIELD}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  {!TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Máx. citas/día (opcional)</label>
                <input type="number" min={1} value={form.maxAppointmentsPerDay} onChange={(e) => set("maxAppointmentsPerDay", e.target.value)} className={FIELD} />
              </div>
            </div>
          </section>
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-4">Políticas de agenda</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5">
                  Antelación mínima (horas)
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">activo</span>
                </label>
                <input type="number" min={0} max={720} value={form.minBookingLeadHours} onChange={(e) => set("minBookingLeadHours", e.target.value)} placeholder="0 = sin restricción" className={FIELD} />
                <p className="text-[11px] text-gray-400 mt-1">El cliente no podrá reservar por debajo de esta antelación (página pública).</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5">
                  Ventana de cancelación (horas)
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">próximamente</span>
                </label>
                <input type="number" min={0} max={720} value={form.cancellationWindowHours} onChange={(e) => set("cancellationWindowHours", e.target.value)} className={FIELD} />
                <p className="text-[11px] text-gray-400 mt-1">Tiempo mínimo antes de la cita para poder cancelar.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5">
                  Margen de no-show (min)
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">próximamente</span>
                </label>
                <input type="number" min={0} max={240} value={form.noShowGraceMinutes} onChange={(e) => set("noShowGraceMinutes", e.target.value)} className={FIELD} />
                <p className="text-[11px] text-gray-400 mt-1">Minutos de cortesía tras la hora antes de marcar "no presentó".</p>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">La antelación mínima ya se aplica en la reserva pública; el resto son políticas documentadas que se aplicarán progresivamente.</p>
          </section>

          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              Aviso de espera larga
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">activo</span>
            </h2>
            <p className="text-sm text-gray-500 mb-4">Umbral del semáforo de espera en el tablero de Visitas y el Monitor.</p>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Aviso ámbar desde (min)</label>
                <input type="number" min={1} max={240} value={form.waitAmberMinutes} onChange={(e) => set("waitAmberMinutes", e.target.value)} placeholder="10" className={FIELD} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Aviso rojo desde (min)</label>
                <input type="number" min={1} max={240} value={form.waitRedMinutes} onChange={(e) => set("waitRedMinutes", e.target.value)} placeholder="20" className={FIELD} />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Por defecto: <span className="text-amber-600 font-medium">ámbar</span> a los 10 min, <span className="text-red-600 font-medium">rojo</span> a los 20 min.</p>
          </section>
          <SaveBar />
        </div>
      )}

      {/* Comunicaciones */}
      {tab === "comunicaciones" && form && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Canales para avisar a los clientes. Las credenciales se guardan cifradas y no se muestran.</p>

          <ChannelCard icon={MessageCircle} name="WhatsApp" sub="Meta Cloud API" status={channels?.whatsapp.status ?? (cfg?.hasMetaWaToken ? "connected" : "pending")}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone Number ID</label>
                <input value={form.metaWaPhoneNumberId} onChange={(e) => set("metaWaPhoneNumberId", e.target.value)} className={FIELD} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1"><Lock className="w-3 h-3 text-gray-400" />Access Token</label>
                {cfg?.hasMetaWaToken && !replacingToken ? (
                  <div className="flex items-center gap-2 h-9">
                    <span className="text-sm text-gray-500 tracking-widest">•••• configurado</span>
                    <button type="button" onClick={() => setReplacingToken(true)} className="text-xs text-blue-600 hover:underline">Reemplazar</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input type="password" value={form.metaWaAccessToken} placeholder="Pega el nuevo token" onChange={(e) => set("metaWaAccessToken", e.target.value)} className={FIELD} />
                    {cfg?.hasMetaWaToken && <button type="button" onClick={() => { setReplacingToken(false); set("metaWaAccessToken", ""); }} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">Cancelar</button>}
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-1">Se guarda cifrado y nunca se vuelve a mostrar.</p>
              </div>
            </div>
            <div className="mt-4"><SaveBar /></div>
            <TestRow ch="whatsapp" />
          </ChannelCard>

          <ChannelCard icon={Mail} name="Email" sub="Resend" status={channels?.email.status ?? "pending"}>
            <div className="text-sm text-gray-600">
              {channels?.email.status === "connected"
                ? <>Configurado en el servidor. Remitente: <span className="font-mono text-gray-800">{channels.email.from}</span>. Pulsa "Probar conexión" para recibir un email de prueba en tu bandeja.</>
                : <>{channels?.email.detail ?? "Cargando…"} La gestión de credenciales por clínica llegará con el envío real (backlog).</>}
            </div>
            <TestRow ch="email" />
          </ChannelCard>

          <ChannelCard icon={MessageSquare} name="SMS" sub="Proveedor español" status={channels?.sms.status ?? "off"}>
            <p className="text-sm text-gray-600">Elige un proveedor (LabsMobile, Esendex, Twilio…) para enviar SMS de recordatorio. Aún sin proveedor integrado (backlog de envío real).</p>
          </ChannelCard>
        </div>
      )}

      {/* RGPD */}
      {tab === "rgpd" && form && (
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-400" />Texto legal de consentimiento RGPD</h2>
            <p className="text-sm text-gray-500 mb-3">Este texto aparece en el apartado RGPD de la ficha de cada cliente, para leer y firmar. Usa <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{"{empresa}"}</code> para insertar el nombre de tu empresa. Trencadis Business Solutions SL figura siempre como encargado del tratamiento.</p>
            <label className="block text-xs font-medium text-gray-600 mb-1">Texto legal</label>
            <textarea value={form.consentText} onChange={(e) => set("consentText", e.target.value)} rows={6}
              className={`${FIELD} text-xs leading-relaxed resize-y`} />
            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Vista previa</p>
              <p className="text-xs text-gray-600 leading-relaxed">{renderConsent(form.consentText, tenant?.name)}</p>
            </div>
          </section>

          <section className={CARD}>
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-400" />Política de retención</h2>
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-gray-600 mb-1">Conservar los datos de clientes</label>
              <select value={form.dataRetentionMonths} onChange={(e) => set("dataRetentionMonths", e.target.value)} className={FIELD}>
                <option value="">Sin límite definido</option>
                <option value="12">12 meses</option>
                <option value="24">24 meses</option>
                <option value="36">36 meses</option>
                <option value="60">5 años</option>
                <option value="120">10 años</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Política documentada. La eliminación automática se aplicará en una iteración posterior.</p>
            </div>
          </section>
          <SaveBar />
          <RgpdTools />
        </div>
      )}

      {/* API */}
      {tab === "api" && <ApiKeysSection />}

      {/* Auditoría */}
      {tab === "auditoria" && <AuditSection />}
    </div>
  );
}
