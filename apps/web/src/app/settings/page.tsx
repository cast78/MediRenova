"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";

interface TenantConfig {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  timezone: string;
  defaultSlotDuration: number;
  bookingGranularity: number;
  maxAppointmentsPerDay: number | null;
  metaWaPhoneNumberId: string | null;
  metaWaAccessToken: string | null;
}
interface TenantMe { name: string; slug: string; config: TenantConfig | null }
interface ApiKey { id: string; name: string; prefix: string; active: boolean; createdAt: string; revokedAt: string | null }

interface ConfigForm {
  timezone: string; defaultSlotDuration: string; bookingGranularity: string; maxAppointmentsPerDay: string;
  primaryColor: string; secondaryColor: string; logoUrl: string;
  metaWaPhoneNumberId: string; metaWaAccessToken: string;
}

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
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 mb-1">API Keys</h2>
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
          className="shrink-0 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">+ Crear</button>
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
              <button onClick={() => revoke.mutate(k.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Revocar</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: tenant } = useQuery<TenantMe>({ queryKey: ["tenant-me"], queryFn: () => apiFetch<TenantMe>("/tenants/me") });
  const [form, setForm] = useState<ConfigForm | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = tenant?.config;
    if (c && !form) {
      setForm({
        timezone: c.timezone, defaultSlotDuration: String(c.defaultSlotDuration), bookingGranularity: String(c.bookingGranularity),
        maxAppointmentsPerDay: c.maxAppointmentsPerDay != null ? String(c.maxAppointmentsPerDay) : "",
        primaryColor: c.primaryColor, secondaryColor: c.secondaryColor, logoUrl: c.logoUrl ?? "",
        metaWaPhoneNumberId: c.metaWaPhoneNumberId ?? "", metaWaAccessToken: c.metaWaAccessToken ?? "",
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
      };
      if (f.maxAppointmentsPerDay) body["maxAppointmentsPerDay"] = parseInt(f.maxAppointmentsPerDay, 10);
      if (f.logoUrl.trim()) body["logoUrl"] = f.logoUrl.trim();
      if (f.metaWaPhoneNumberId.trim()) body["metaWaPhoneNumberId"] = f.metaWaPhoneNumberId.trim();
      if (f.metaWaAccessToken.trim()) body["metaWaAccessToken"] = f.metaWaAccessToken.trim();
      return apiFetch("/tenants/me/config", { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => { setMsg("Cambios guardados"); setError(null); setTimeout(() => setMsg(null), 2500); void queryClient.invalidateQueries({ queryKey: ["tenant-me"] }); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  function set<K extends keyof ConfigForm>(key: K, val: ConfigForm[K]) {
    setForm((f) => (f ? { ...f, [key]: val } : f));
  }

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Configuración</h1>
        <p className="text-sm text-gray-500 mt-0.5">{tenant?.name}{tenant?.slug ? ` · ${tenant.slug}` : ""}</p>
      </div>

      {form && (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5">
          {/* Reservas */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Reservas</h2>
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
                <input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className={FIELD} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Máx. citas/día (opcional)</label>
                <input type="number" min={1} value={form.maxAppointmentsPerDay} onChange={(e) => set("maxAppointmentsPerDay", e.target.value)} className={FIELD} />
              </div>
            </div>
          </section>

          {/* Branding */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Branding</h2>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">URL del logo</label>
                <input value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" className={FIELD} />
              </div>
            </div>
          </section>

          {/* WhatsApp */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-1">WhatsApp (Meta Cloud API)</h2>
            <p className="text-sm text-gray-500 mb-4">Para los avisos de caducidad. Requiere plantillas aprobadas por Meta.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone Number ID</label>
                <input value={form.metaWaPhoneNumberId} onChange={(e) => set("metaWaPhoneNumberId", e.target.value)} className={FIELD} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Access Token</label>
                <input type="password" value={form.metaWaAccessToken} onChange={(e) => set("metaWaAccessToken", e.target.value)} className={FIELD} />
              </div>
            </div>
          </section>

          <div className="flex items-center justify-end gap-3">
            {msg && <span className="text-sm text-green-600">{msg}</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button type="submit" disabled={save.isPending} className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50">
              {save.isPending ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      )}

      <ApiKeysSection />
    </div>
  );
}
