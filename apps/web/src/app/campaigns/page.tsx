"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Pencil, Clock, CheckCircle2, XCircle, Loader2, Ban, Mail, MessageSquare, MessageCircle, FileText, Users, ArrowRight, Send, Trash2, BarChart3, Package, Cake, Building2, AlertTriangle, AlarmClock, Copy } from "lucide-react";

// ── Tipos ────────────────────────────────────────────────────────────────────
type Channel = "EMAIL" | "WHATSAPP" | "SMS";
interface Template {
  id: string;
  name: string;
  channel: Channel;
  subject: string | null;
  body: string;
  active: boolean;
  updatedAt: string;
  campaignCount: number;
  lastUsedAt: string | null;
}

const CHANNELS: { key: Channel; label: string; hint: string }[] = [
  { key: "EMAIL", label: "Email", hint: "Asunto + cuerpo" },
  { key: "WHATSAPP", label: "WhatsApp", hint: "Requiere plantilla aprobada en Meta para envío automático" },
  { key: "SMS", label: "SMS", hint: "Texto breve" },
];
const CHANNEL_LABEL: Record<Channel, string> = { EMAIL: "Email", WHATSAPP: "WhatsApp", SMS: "SMS" };
const CHANNEL_PILL: Record<Channel, string> = {
  EMAIL: "bg-blue-50 text-blue-700",
  WHATSAPP: "bg-emerald-50 text-emerald-700",
  SMS: "bg-violet-50 text-violet-700",
};
// Círculo de identidad por canal (para las tarjetas de plantilla).
const CHANNEL_CIRCLE: Record<Channel, string> = {
  EMAIL: "bg-blue-50 text-blue-600",
  WHATSAPP: "bg-emerald-50 text-emerald-600",
  SMS: "bg-violet-50 text-violet-600",
};
// Color (solo texto, sin fondo) de las variables resaltadas en la vista previa.
const VAR_COLOR: Record<Channel, string> = {
  EMAIL: "text-blue-600",
  WHATSAPP: "text-emerald-600",
  SMS: "text-violet-600",
};

// Variables disponibles y valores de ejemplo para la previsualización.
const VARS: { key: string; label: string; sample: string }[] = [
  { key: "nombre", label: "{{nombre}}", sample: "María" },
  { key: "apellido", label: "{{apellido}}", sample: "García" },
  { key: "producto", label: "{{producto}}", sample: "Carnet de Conducir (B)" },
  { key: "caduca", label: "{{caduca}}", sample: "15/09/2026" },
  { key: "centro", label: "{{centro}}", sample: "Centro Madrid Salamanca" },
];
const SAMPLE = Object.fromEntries(VARS.map((v) => [v.key, v.sample]));

// Variables {{x}} presentes en un texto (para los chips de la tarjeta).
function usedVars(text: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m[1] as string);
  return [...set];
}

// Cuerpo con las variables sustituidas por su valor de ejemplo y RESALTADAS,
// para la vista previa realista por canal.
function highlight(text: string, colorCls: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={key++} className={`bg-transparent font-medium ${colorCls}`}>{SAMPLE[m[1] as string] ?? m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Array.isArray(e.errors) ? (e.errors[0] as { message?: string; code?: string }) : undefined;
    return first?.message ?? first?.code ?? `Error ${e.status}`;
  }
  return "Error inesperado";
}

// ── Página ───────────────────────────────────────────────────────────────────
type Tab = "templates" | "segments" | "campaigns";

export default function CampaignsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("campaigns");

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-4 flex-wrap mb-5">
        <h1 className="text-xl font-bold text-gray-900">Campañas</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {([["campaigns", "Campañas"], ["templates", "Plantillas"], ["segments", "Segmentos"]] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {!isAdmin ? (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4">
          Esta sección es solo para administradores.
        </p>
      ) : tab === "templates" ? (
        <TemplatesTab />
      ) : tab === "segments" ? (
        <SegmentsTab />
      ) : (
        <CampaignsTab />
      )}
    </div>
  );
}

// ── Pestaña Plantillas ───────────────────────────────────────────────────────
function TemplatesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["message-templates"],
    queryFn: () => apiFetch<Template[]>("/message-templates"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/message-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => { setConfirmDelete(null); qc.invalidateQueries({ queryKey: ["message-templates"] }); },
  });
  // Duplicar: crea una copia inactiva reutilizando el endpoint de creación.
  const duplicate = useMutation({
    mutationFn: (t: Template) => apiFetch("/message-templates", {
      method: "POST",
      body: JSON.stringify({ name: `${t.name} (copia)`, channel: t.channel, body: t.body, active: false, ...(t.channel === "EMAIL" && t.subject ? { subject: t.subject } : {}) }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["message-templates"] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Mensajes reutilizables para avisos y campañas. Usa variables como <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{"{{nombre}}"}</code>.</p>
        <button onClick={() => setEditing("new")}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium shadow-sm transition-colors shrink-0">
          + Nueva plantilla
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : !templates || templates.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">Aún no hay plantillas. Crea la primera para reutilizarla en tus campañas.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {[...templates].sort((a, b) => a.name.localeCompare(b.name, "es")).map((t) => {
            const CIcon = CHANNEL_ICON[t.channel];
            const vars = usedVars(`${t.subject ?? ""} ${t.body}`);
            const vc = VAR_COLOR[t.channel];
            const preview = t.channel === "EMAIL" ? (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                {t.subject && <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs"><span className="text-gray-400">Asunto</span> <span className="text-gray-800 font-medium">{highlight(t.subject, vc)}</span></div>}
                <div className="p-3 text-[13px] text-gray-600 leading-relaxed whitespace-pre-wrap">{highlight(t.body, vc)}</div>
              </div>
            ) : t.channel === "WHATSAPP" ? (
              <div className="p-3 rounded-lg bg-gray-50 flex justify-end">
                <div className="max-w-[85%] px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap" style={{ background: "#DCF7C5", color: "#173404", borderRadius: "12px 12px 3px 12px" }}>{highlight(t.body, vc)}</div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-gray-50 flex justify-start">
                <div className="max-w-[85%] px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap bg-white border border-gray-200 text-gray-800" style={{ borderRadius: "12px 12px 12px 3px" }}>{highlight(t.body, vc)}</div>
              </div>
            );
            return (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
                <div className="flex items-center gap-3 p-4 pb-3">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${CHANNEL_CIRCLE[t.channel]}`}><CIcon className="w-[18px] h-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">{t.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${t.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{t.active ? "Activa" : "Inactiva"}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{CHANNEL_LABEL[t.channel]}{t.channel === "SMS" ? ` · ${t.body.length} caracteres` : ""} · actualizado {new Date(t.updatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setEditing(t)} title="Editar" aria-label="Editar" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => duplicate.mutate(t)} disabled={duplicate.isPending} title="Duplicar" aria-label="Duplicar" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 disabled:opacity-50"><Copy className="w-4 h-4" /></button>
                    {confirmDelete === t.id ? (
                      <button onClick={() => del.mutate(t.id)} disabled={del.isPending} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">Confirmar</button>
                    ) : (
                      <button onClick={() => setConfirmDelete(t.id)} title="Borrar" aria-label="Borrar" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
                <div className="px-4">{preview}</div>
                <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 flex-wrap">
                  {vars.length > 0 ? (
                    <>
                      <span className="text-[11px] text-gray-400">Variables:</span>
                      {vars.map((v) => <span key={v} className={`text-[11px] px-1.5 py-0.5 rounded bg-gray-50 border border-gray-100 font-mono ${vc}`}>{v}</span>)}
                    </>
                  ) : (
                    <span className="text-[11px] text-gray-400">Sin variables · texto fijo</span>
                  )}
                </div>
                <div className="px-4 pb-3 flex items-center gap-1.5 text-[11px] text-gray-400 border-t border-gray-50 pt-2">
                  <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                  {t.campaignCount > 0 ? (
                    <span>Usada en <span className="font-medium text-gray-600">{t.campaignCount}</span> {t.campaignCount === 1 ? "campaña" : "campañas"}{t.lastUsedAt ? ` · última ${new Date(t.lastUsedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}` : ""}</span>
                  ) : (
                    <span>Sin usar en campañas todavía</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <TemplateModal key={editing === "new" ? "new" : editing.id} template={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["message-templates"] }); }} />}
    </div>
  );
}

// ── Modal crear/editar ───────────────────────────────────────────────────────
function TemplateModal({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState<Channel>(template?.channel ?? "EMAIL");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { name, channel, body, active };
      if (channel === "EMAIL") payload["subject"] = subject;
      return template
        ? apiFetch(`/message-templates/${template.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : apiFetch("/message-templates", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  });

  const canSave = name.trim() && body.trim() && (channel !== "EMAIL" || subject.trim()) && !save.isPending;

  function insertVar(v: string) {
    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}${v}`);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-blue-600" /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">{template ? "Editar plantilla" : "Nueva plantilla"}</h2>
            <p className="text-xs text-gray-500">Mensaje reutilizable para campañas y avisos</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recordatorio de renovación"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Canal</label>
            <div className="flex gap-2">
              {CHANNELS.map((c) => {
                const CI = CHANNEL_ICON[c.key];
                return (
                  <button key={c.key} onClick={() => setChannel(c.key)} type="button"
                    className={`px-3 py-1.5 text-sm rounded-lg border inline-flex items-center gap-1.5 transition-colors ${channel === c.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    <CI className="w-4 h-4" /> {c.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">{CHANNELS.find((c) => c.key === channel)?.hint}</p>
          </div>

          {channel === "EMAIL" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Asunto</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Su certificado de {{producto}} caduca pronto"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-500">Cuerpo</label>
              <div className="flex flex-wrap gap-1">
                {VARS.map((v) => (
                  <button key={v.key} type="button" onClick={() => insertVar(v.label)}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 font-mono">
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Hola {{nombre}}, le recordamos que su certificado de {{producto}} caduca el {{caduca}}…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          </div>

          {/* Previsualización realista según el canal, con datos de ejemplo */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Vista previa · así lo recibe el cliente</label>
            {channel === "EMAIL" ? (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                {subject && <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs"><span className="text-gray-400">Asunto</span> <span className="text-gray-800 font-medium">{highlight(subject, "text-blue-600")}</span></div>}
                <div className="p-3 text-[13px] text-gray-600 leading-relaxed whitespace-pre-wrap min-h-[2.5rem]">{body ? highlight(body, "text-blue-600") : <span className="text-gray-400">El cuerpo aparecerá aquí…</span>}</div>
              </div>
            ) : channel === "WHATSAPP" ? (
              <div className="p-3 rounded-lg bg-gray-50 flex justify-end">
                <div className="max-w-[85%] px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap" style={{ background: "#DCF7C5", color: "#173404", borderRadius: "12px 12px 3px 12px" }}>{body ? highlight(body, "text-emerald-600") : "El mensaje aparecerá aquí…"}</div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-gray-50 flex justify-start">
                <div className="max-w-[85%] px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap bg-white border border-gray-200 text-gray-800" style={{ borderRadius: "12px 12px 12px 3px" }}>{body ? highlight(body, "text-violet-600") : <span className="text-gray-400">El mensaje aparecerá aquí…</span>}</div>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded" />
            Activa
          </label>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => save.mutate()} disabled={!canSave}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {save.isPending ? "Guardando…" : template ? "Guardar cambios" : "Crear plantilla"}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Segmentos ────────────────────────────────────────────────────────────────
interface SegmentDef {
  channel?: Channel;
  productIds?: string[];
  expiringInDays?: number;
  includeExpired?: boolean;
  ageMin?: number;
  ageMax?: number;
  centerIds?: string[];
  hasNoShow?: boolean;
}
interface Segment { id: string; name: string; definition: SegmentDef; updatedAt: string }
interface NamedRef { id: string; name: string }
interface PreviewResult { count: number; sample: { id: string; firstName: string | null; lastName: string | null }[] }

const custName = (c: { firstName: string | null; lastName: string | null }) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";


// Conteo en vivo de una definición (usado en tarjetas y en el builder).
function usePreview(def: SegmentDef, enabled = true) {
  const key = JSON.stringify(def);
  return useQuery<PreviewResult>({
    queryKey: ["segment-preview", key],
    queryFn: () => apiFetch<PreviewResult>("/segments/preview", { method: "POST", body: JSON.stringify({ definition: def }) }),
    enabled,
    staleTime: 30_000,
  });
}

function SegmentsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: segments, isLoading } = useQuery<Segment[]>({
    queryKey: ["segments"],
    queryFn: () => apiFetch<Segment[]>("/segments"),
  });
  // Productos y centros para mostrar nombres reales en los chips de reglas.
  const { data: products } = useQuery<NamedRef[]>({ queryKey: ["products"], queryFn: () => apiFetch<NamedRef[]>("/products"), staleTime: 5 * 60_000 });
  const { data: centers } = useQuery<NamedRef[]>({ queryKey: ["centers"], queryFn: () => apiFetch<NamedRef[]>("/centers"), staleTime: 5 * 60_000 });
  const names: NameMaps = useMemo(() => ({
    products: new Map((products ?? []).map((p) => [p.id, p.name])),
    centers: new Map((centers ?? []).map((c) => [c.id, c.name])),
  }), [products, centers]);

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/segments/${id}`, { method: "DELETE" }),
    onSuccess: () => { setConfirmDelete(null); qc.invalidateQueries({ queryKey: ["segments"] }); },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Grupos de clientes definidos por filtros. El conteo es siempre en vivo.</p>
        <button onClick={() => setEditing("new")}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium shadow-sm transition-colors shrink-0">
          + Nuevo segmento
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : !segments || segments.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">Aún no hay segmentos. Crea el primero (p. ej. «caducan en 90 días»).</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...segments].sort((a, b) => a.name.localeCompare(b.name, "es")).map((s) => (
            <SegmentCard key={s.id} segment={s} names={names}
              onEdit={() => setEditing(s)}
              confirming={confirmDelete === s.id}
              onAskDelete={() => setConfirmDelete(s.id)}
              onConfirmDelete={() => del.mutate(s.id)}
              deleting={del.isPending} />
          ))}
        </div>
      )}

      {editing && <SegmentModal key={editing === "new" ? "new" : editing.id} segment={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["segments"] }); }} />}
    </div>
  );
}

// Mapas opcionales id→nombre para mostrar nombres reales en los chips.
type NameMaps = { products?: Map<string, string>; centers?: Map<string, string> };

// Resuelve una lista de ids a un texto compacto de nombres ("A, B" o "A +2").
function namesText(ids: string[], map: Map<string, string> | undefined, fallbackSingular: string): string {
  const labels = map ? (ids.map((id) => map.get(id)).filter(Boolean) as string[]) : [];
  if (!labels.length) return `${ids.length} ${fallbackSingular}${ids.length === 1 ? "" : "s"}`;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]} +${labels.length - 1}`;
}

// Reglas de la definición como chips con icono (mapeo campo → chip legible).
function ruleChips(def: SegmentDef, names?: NameMaps): { icon: typeof Users; text: string }[] {
  const out: { icon: typeof Users; text: string }[] = [];
  if (def.channel) out.push({ icon: CHANNEL_ICON[def.channel], text: `Consiente ${CHANNEL_LABEL[def.channel]}` });
  if (def.productIds?.length) out.push({ icon: Package, text: namesText(def.productIds, names?.products, "producto") });
  if (def.expiringInDays) out.push({ icon: AlarmClock, text: `Caduca ≤ ${def.expiringInDays} días${def.includeExpired ? " · +vencidas" : ""}` });
  if (def.ageMin != null || def.ageMax != null) out.push({ icon: Cake, text: `Edad ${def.ageMin ?? 0}–${def.ageMax ?? "∞"}` });
  if (def.centerIds?.length) out.push({ icon: Building2, text: namesText(def.centerIds, names?.centers, "centro") });
  if (def.hasNoShow) out.push({ icon: AlertTriangle, text: "Faltó a una cita" });
  return out;
}
const AV_COLORS = ["bg-blue-50 text-blue-700", "bg-emerald-50 text-emerald-700", "bg-violet-50 text-violet-700", "bg-amber-50 text-amber-700", "bg-pink-50 text-pink-700"];
const initials = (c: { firstName: string | null; lastName: string | null }) => (`${(c.firstName ?? "").trim()[0] ?? ""}${(c.lastName ?? "").trim()[0] ?? ""}`).toUpperCase() || "?";
const shortName = (c: { firstName: string | null; lastName: string | null }) => `${c.firstName ?? "Cliente"}${c.lastName ? ` ${c.lastName[0]}.` : ""}`.trim();

// Tarjeta de segmento: conteo en vivo + muestra de clientes reales + reglas con iconos.
function SegmentCard({ segment, names, onEdit, confirming, onAskDelete, onConfirmDelete, deleting }: {
  segment: Segment; names: NameMaps; onEdit: () => void; confirming: boolean; onAskDelete: () => void; onConfirmDelete: () => void; deleting: boolean;
}) {
  const { data } = usePreview(segment.definition);
  const chips = ruleChips(segment.definition, names);
  const sample = data?.sample ?? [];
  const avatars = sample.slice(0, 4);
  const listed = sample.slice(0, 2).map(shortName).join(", ");
  const rest = (data?.count ?? sample.length) - Math.min(sample.length, 2);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0"><Users className="w-[18px] h-[18px] text-blue-600" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 truncate">{segment.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> conteo en vivo
            <span className="text-gray-300">·</span>
            <span title="Última actualización">actualizado {new Date(segment.updatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-blue-700 leading-none">{data ? data.count : "…"}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">clientes</p>
        </div>
      </div>

      {avatars.length > 0 && (
        <div className="flex items-center mt-3">
          <div className="flex">
            {avatars.map((c, i) => (
              <span key={c.id} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium border-2 border-white ${AV_COLORS[i % AV_COLORS.length]} ${i > 0 ? "-ml-1.5" : ""}`}>{initials(c)}</span>
            ))}
          </div>
          <span className="text-[11px] text-gray-500 ml-2 truncate">{listed}{rest > 0 ? ` y ${rest} más` : ""}</span>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Reglas</p>
        <div className="flex flex-wrap gap-1.5">
          {chips.length === 0 ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-gray-500">Todos los clientes</span>
          ) : chips.map((ch, i) => {
            const Icon = ch.icon;
            return <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-gray-600 inline-flex items-center gap-1"><Icon className="w-3 h-3" /> {ch.text}</span>;
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
        <button onClick={onEdit} title="Editar" aria-label="Editar" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700"><Pencil className="w-4 h-4" /></button>
        {confirming ? (
          <button onClick={onConfirmDelete} disabled={deleting} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">Confirmar</button>
        ) : (
          <button onClick={onAskDelete} title="Borrar" aria-label="Borrar" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    </div>
  );
}

function SegmentModal({ segment, onClose, onSaved }: { segment: Segment | null; onClose: () => void; onSaved: () => void }) {
  const d = segment?.definition ?? {};
  const [name, setName] = useState(segment?.name ?? "");
  const [channel, setChannel] = useState<Channel | "">(d.channel ?? "");
  const [productIds, setProductIds] = useState<string[]>(d.productIds ? [...d.productIds] : []);
  const [expiringInDays, setExpiringInDays] = useState<number | "">(d.expiringInDays ?? "");
  const [includeExpired, setIncludeExpired] = useState<boolean>(d.includeExpired ?? false);
  const [ageMin, setAgeMin] = useState<string>(d.ageMin != null ? String(d.ageMin) : "");
  const [ageMax, setAgeMax] = useState<string>(d.ageMax != null ? String(d.ageMax) : "");
  const [centerIds, setCenterIds] = useState<string[]>(d.centerIds ? [...d.centerIds] : []);
  const [hasNoShow, setHasNoShow] = useState<boolean>(d.hasNoShow ?? false);
  const [error, setError] = useState<string | null>(null);

  const { data: products } = useQuery<NamedRef[]>({ queryKey: ["products"], queryFn: () => apiFetch<NamedRef[]>("/products"), staleTime: 5 * 60_000 });
  const { data: centers } = useQuery<NamedRef[]>({ queryKey: ["centers"], queryFn: () => apiFetch<NamedRef[]>("/centers"), staleTime: 5 * 60_000 });

  const def = useMemo<SegmentDef>(() => {
    const out: SegmentDef = {};
    if (channel) out.channel = channel;
    if (productIds.length) out.productIds = productIds;
    if (expiringInDays) { out.expiringInDays = Number(expiringInDays); if (includeExpired) out.includeExpired = true; }
    if (ageMin !== "") out.ageMin = Number(ageMin);
    if (ageMax !== "") out.ageMax = Number(ageMax);
    if (centerIds.length) out.centerIds = centerIds;
    if (hasNoShow) out.hasNoShow = true;
    return out;
  }, [channel, productIds, expiringInDays, includeExpired, ageMin, ageMax, centerIds, hasNoShow]);

  // Debounce de la definición para no lanzar preview en cada tecla.
  const [debounced, setDebounced] = useState(def);
  useEffect(() => { const t = setTimeout(() => setDebounced(def), 400); return () => clearTimeout(t); }, [def]);
  const { data: preview, isFetching } = usePreview(debounced);

  const save = useMutation({
    mutationFn: () => segment
      ? apiFetch(`/segments/${segment.id}`, { method: "PATCH", body: JSON.stringify({ name, definition: def }) })
      : apiFetch("/segments", { method: "POST", body: JSON.stringify({ name, definition: def }) }),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  });

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const EXPIRY = [30, 60, 90, 365];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-blue-600" /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">{segment ? "Editar segmento" : "Nuevo segmento"}</h2>
            <p className="text-xs text-gray-500">Grupo de clientes definido por filtros · conteo en vivo</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Caducan en 90 días"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Filtros (todos opcionales)</p>

            {/* Caducidad */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Caducidad del certificado</label>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setExpiringInDays("")}
                  className={`text-xs px-2.5 py-1 rounded-lg border ${!expiringInDays ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>Cualquiera</button>
                {EXPIRY.map((n) => (
                  <button key={n} type="button" onClick={() => setExpiringInDays(n)}
                    className={`text-xs px-2.5 py-1 rounded-lg border ${expiringInDays === n ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    ≤ {n === 365 ? "1 año" : `${n}d`}
                  </button>
                ))}
                {!!expiringInDays && (
                  <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="rounded" />
                    incluir vencidas
                  </label>
                )}
              </div>
            </div>

            {/* Productos */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Producto tomado</label>
              <div className="flex flex-wrap gap-1.5">
                {(products ?? []).map((p) => (
                  <button key={p.id} type="button" onClick={() => toggle(productIds, setProductIds, p.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg border ${productIds.includes(p.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    {p.name}
                  </button>
                ))}
                {(products ?? []).length === 0 && <span className="text-xs text-gray-400">Sin productos</span>}
              </div>
            </div>

            {/* Centros */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Centro</label>
              <div className="flex flex-wrap gap-1.5">
                {(centers ?? []).map((c) => (
                  <button key={c.id} type="button" onClick={() => toggle(centerIds, setCenterIds, c.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg border ${centerIds.includes(c.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    {c.name}
                  </button>
                ))}
                {(centers ?? []).length === 0 && <span className="text-xs text-gray-400">Sin centros</span>}
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              {/* Edad */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Edad</label>
                <div className="flex items-center gap-1.5 text-sm">
                  <input type="number" min={0} max={120} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="mín"
                    className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                  <span className="text-gray-400">–</span>
                  <input type="number" min={0} max={120} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="máx"
                    className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>

              {/* Canal / consentimiento */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Consiente canal</label>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setChannel("")}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border ${!channel ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>Cualquiera</button>
                  {(["EMAIL", "WHATSAPP", "SMS"] as Channel[]).map((c) => {
                    const CI = CHANNEL_ICON[c];
                    return (
                      <button key={c} type="button" onClick={() => setChannel(c)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1 ${channel === c ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                        <CI className="w-3.5 h-3.5" /> {CHANNEL_LABEL[c]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* No-show */}
            <label className="flex items-center gap-2 text-sm text-gray-600 mt-3">
              <input type="checkbox" checked={hasNoShow} onChange={(e) => setHasNoShow(e.target.checked)} className="rounded" />
              Solo clientes que faltaron a alguna cita (no se presentaron)
            </label>
          </div>

          {/* Preview en vivo */}
          <div className="rounded-lg bg-blue-50/60 border border-blue-100 p-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-blue-700 tabular-nums">{preview ? preview.count : "…"}</span>
              <span className="text-sm text-blue-700">clientes en este segmento{isFetching ? " (actualizando…)" : ""}</span>
            </div>
            {preview && preview.sample.length > 0 && (
              <p className="text-xs text-blue-600/80 mt-1 truncate">{preview.sample.map(custName).join(", ")}{preview.count > preview.sample.length ? "…" : ""}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {save.isPending ? "Guardando…" : segment ? "Guardar cambios" : "Crear segmento"}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Campañas ─────────────────────────────────────────────────────────────────
interface CampaignRow {
  id: string;
  name: string;
  channel: Channel;
  status: "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
  scheduledAt: string | null;
  sentAt: string | null;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  template: { name: string };
  segment: { name: string };
}
interface Recipient { id: string; status: "PENDING" | "SENT" | "FAILED" | "SKIPPED"; error: string | null; customer: { firstName: string | null; lastName: string | null } }
interface CampaignDetail extends CampaignRow { recipients: Recipient[] }

const CSTATUS: Record<CampaignRow["status"], { label: string; cls: string }> = {
  DRAFT: { label: "Borrador", cls: "bg-gray-100 text-gray-600" },
  SCHEDULED: { label: "Programada", cls: "bg-amber-50 text-amber-700" },
  SENDING: { label: "Enviando…", cls: "bg-blue-50 text-blue-700" },
  SENT: { label: "Enviada", cls: "bg-emerald-50 text-emerald-700" },
  FAILED: { label: "Fallida", cls: "bg-red-50 text-red-700" },
  CANCELLED: { label: "Cancelada", cls: "bg-gray-100 text-gray-500" },
};
const RSTATUS: Record<Recipient["status"], { label: string; cls: string }> = {
  SENT: { label: "Enviado", cls: "bg-emerald-50 text-emerald-700" },
  FAILED: { label: "Fallido", cls: "bg-red-50 text-red-700" },
  SKIPPED: { label: "Omitido", cls: "bg-gray-100 text-gray-500" },
  PENDING: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
};
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

// Icono + color del círculo de estado de la campaña.
const SVIZ: Record<CampaignRow["status"], { icon: typeof Clock; circle: string; color: string }> = {
  DRAFT: { icon: Pencil, circle: "bg-gray-100", color: "text-gray-500" },
  SCHEDULED: { icon: Clock, circle: "bg-amber-50", color: "text-amber-700" },
  SENDING: { icon: Loader2, circle: "bg-blue-50", color: "text-blue-600" },
  SENT: { icon: CheckCircle2, circle: "bg-emerald-50", color: "text-emerald-600" },
  FAILED: { icon: XCircle, circle: "bg-red-50", color: "text-red-600" },
  CANCELLED: { icon: Ban, circle: "bg-gray-100", color: "text-gray-400" },
};
const CHANNEL_ICON: Record<Channel, typeof Mail> = { EMAIL: Mail, WHATSAPP: MessageCircle, SMS: MessageSquare };

function CampaignsTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: campaigns, isLoading } = useQuery<CampaignRow[]>({
    queryKey: ["campaigns"],
    queryFn: () => apiFetch<CampaignRow[]>("/campaigns"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["campaigns"] });

  const send = useMutation({
    mutationFn: (id: string) => apiFetch(`/campaigns/${id}/send`, { method: "POST" }),
    onSuccess: () => { setConfirmSend(null); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => { setConfirmDelete(null); invalidate(); },
  });

  const list = campaigns ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sentMonth = list.filter((c) => c.status === "SENT" && c.sentAt && new Date(c.sentAt) >= monthStart);
  const kAlcance = sentMonth.reduce((n, c) => n + c.sentCount, 0);
  const kFailed = sentMonth.reduce((n, c) => n + c.failedCount, 0);
  const kTasa = kAlcance + kFailed > 0 ? Math.round((kAlcance / (kAlcance + kFailed)) * 100) : null;
  const kProgramadas = list.filter((c) => c.status === "SCHEDULED").length;
  const isActiveStatus = (s: CampaignRow["status"]) => s === "DRAFT" || s === "SCHEDULED" || s === "SENDING";
  const activas = list.filter((c) => isActiveStatus(c.status));
  const historial = list.filter((c) => !isActiveStatus(c.status)).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));

  // Tarjeta enriquecida, reutilizada en Activas e Historial.
  const card = (c: CampaignRow) => {
    const viz = SVIZ[c.status];
    const SIcon = viz.icon;
    const CIcon = CHANNEL_ICON[c.channel];
    const isSent = c.status === "SENT" || c.status === "FAILED";
    const denom = c.totalCount || c.sentCount + c.skippedCount + c.failedCount;
    const pct = (n: number) => (denom > 0 ? (n / denom) * 100 : 0);
    const rate = c.sentCount + c.failedCount > 0 ? Math.round((c.sentCount / (c.sentCount + c.failedCount)) * 100) : null;
    const sendable = c.status === "DRAFT" || c.status === "SCHEDULED";
    return (
      <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3.5">
        <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${viz.circle}`}>
          <SIcon className={`w-[18px] h-[18px] ${viz.color} ${c.status === "SENDING" ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">{c.name}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${CSTATUS[c.status].cls}`}>{CSTATUS[c.status].label}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${CHANNEL_PILL[c.channel]}`}><CIcon className="w-3 h-3" /> {CHANNEL_LABEL[c.channel]}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <FileText className="w-3.5 h-3.5 text-gray-400" /> {c.template.name}
            <ArrowRight className="w-3 h-3 text-gray-300" />
            <Users className="w-3.5 h-3.5 text-gray-400" /> {c.segment.name}
            {c.status === "SCHEDULED" && c.scheduledAt && <span className="text-gray-400">· programada {fmtDate(c.scheduledAt)}</span>}
            {c.status === "SENT" && <span className="text-gray-400">· enviada {fmtDate(c.sentAt)}</span>}
          </p>
          {isSent && (
            <div className="flex items-center gap-3 mt-2">
              <div className="h-1.5 rounded-full bg-gray-100 flex overflow-hidden w-full max-w-[220px]">
                <span className="bg-green-500" style={{ width: `${pct(c.sentCount)}%` }} />
                <span className="bg-gray-300" style={{ width: `${pct(c.skippedCount)}%` }} />
                <span className="bg-red-500" style={{ width: `${pct(c.failedCount)}%` }} />
              </div>
              <span className="text-[11px] text-gray-500 whitespace-nowrap">
                <span className="text-green-700">{c.sentCount} enviados</span>
                {c.skippedCount > 0 && <> · {c.skippedCount} omitidos</>}
                {c.failedCount > 0 && <span className="text-red-600"> · {c.failedCount} fallidos</span>}
                {rate !== null && <> · {rate}%</>}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSent && (
            <button onClick={() => setDetailId(c.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 inline-flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" /> Resultados</button>
          )}
          {sendable && (
            confirmSend === c.id ? (
              <button onClick={() => send.mutate(c.id)} disabled={send.isPending} className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{send.isPending ? "Enviando…" : "Confirmar envío"}</button>
            ) : (
              <button onClick={() => setConfirmSend(c.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium inline-flex items-center gap-1"><Send className="w-3.5 h-3.5" /> Enviar ahora</button>
            )
          )}
          {c.status !== "SENDING" && (
            confirmDelete === c.id ? (
              <button onClick={() => del.mutate(c.id)} disabled={del.isPending} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">Confirmar</button>
            ) : (
              <button onClick={() => setConfirmDelete(c.id)} aria-label="Borrar" title="Borrar" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Envía una plantilla a un segmento. El envío respeta el consentimiento por canal.</p>
        <button onClick={() => setCreating(true)}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium shadow-sm transition-colors shrink-0">
          + Nueva campaña
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : list.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">Aún no hay campañas. Crea una eligiendo un segmento y una plantilla.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3"><div className="flex items-center justify-between"><span className="text-[11px] text-gray-400">Enviadas (mes)</span><Send className="w-3.5 h-3.5 text-gray-400" /></div><p className="text-2xl font-bold text-gray-800 mt-0.5">{sentMonth.length}</p></div>
            <div className="bg-blue-50 rounded-xl border border-blue-100 px-4 py-3"><div className="flex items-center justify-between"><span className="text-[11px] text-blue-600">Alcance (mes)</span><Users className="w-3.5 h-3.5 text-blue-500" /></div><p className="text-2xl font-bold text-blue-700 mt-0.5">{kAlcance.toLocaleString("es-ES")}</p></div>
            <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-4 py-3"><div className="flex items-center justify-between"><span className="text-[11px] text-emerald-700">Tasa de entrega</span><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /></div><p className="text-2xl font-bold text-emerald-700 mt-0.5">{kTasa === null ? "—" : `${kTasa}%`}</p></div>
            <div className="bg-amber-50 rounded-xl border border-amber-100 px-4 py-3"><div className="flex items-center justify-between"><span className="text-[11px] text-amber-700">Programadas</span><Clock className="w-3.5 h-3.5 text-amber-600" /></div><p className="text-2xl font-bold text-amber-700 mt-0.5">{kProgramadas}</p></div>
          </div>

          {activas.length > 0 && (
            <div className="mb-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Activas</p>
              <div className="space-y-2.5">{activas.map(card)}</div>
            </div>
          )}
          {historial.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Historial</p>
              <div className="space-y-2.5">{historial.map(card)}</div>
            </div>
          )}
        </>
      )}

      {creating && <CampaignModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); invalidate(); }} />}
      {detailId && <CampaignDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function CampaignModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: templates } = useQuery<Template[]>({ queryKey: ["message-templates"], queryFn: () => apiFetch<Template[]>("/message-templates") });
  const { data: segments } = useQuery<Segment[]>({ queryKey: ["segments"], queryFn: () => apiFetch<Segment[]>("/segments") });

  const template = templates?.find((t) => t.id === templateId);
  const segment = segments?.find((s) => s.id === segmentId);
  const { data: preview } = usePreview(segment?.definition ?? {}, !!segment);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { name, templateId, segmentId };
      if (scheduled && scheduledAt) payload["scheduledAt"] = new Date(scheduledAt).toISOString();
      return apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  });

  const canSave = name.trim() && templateId && segmentId && (!scheduled || scheduledAt) && !save.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><Send className="w-5 h-5 text-blue-600" /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">Nueva campaña</h2>
            <p className="text-xs text-gray-500">Envía una plantilla a un segmento · respeta el consentimiento por canal</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recordatorio julio"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Plantilla</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Elige plantilla…</option>
              {(templates ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} · {CHANNEL_LABEL[t.channel]}</option>)}
            </select>
            {template && <p className="text-[11px] text-gray-400 mt-1">Canal: {CHANNEL_LABEL[template.channel]}{template.channel !== "EMAIL" ? " (en pruebas se registra; requiere proveedor en producción)" : ""}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Segmento</label>
            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Elige segmento…</option>
              {(segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {segment && <p className="text-[11px] text-blue-600 mt-1">Llegará a ≈ {preview ? preview.count : "…"} clientes (según consentimiento del canal al enviar).</p>}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} className="rounded" />
              Programar envío
            </label>
            {scheduled && (
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                className="mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            )}
            <p className="text-[11px] text-gray-400 mt-1">{scheduled ? "Se enviará automáticamente a partir de esa fecha (barrido diario)." : "Sin programar: quedará en Borrador y la envías tú con «Enviar ahora»."}</p>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => save.mutate()} disabled={!canSave}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {save.isPending ? "Creando…" : "Crear campaña"}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function CampaignDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<CampaignDetail>({ queryKey: ["campaign", id], queryFn: () => apiFetch<CampaignDetail>(`/campaigns/${id}`) });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{data?.name ?? "Resultados"}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {isLoading || !data ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 mb-4">
              <Stat label="Total" value={data.totalCount} />
              <Stat label="Enviados" value={data.sentCount} cls="text-emerald-700" />
              <Stat label="Omitidos" value={data.skippedCount} cls="text-gray-500" />
              <Stat label="Fallidos" value={data.failedCount} cls="text-red-600" />
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-400 text-xs">
                  <tr><th className="text-left font-medium px-3 py-2">Cliente</th><th className="text-left font-medium px-3 py-2">Estado</th><th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Detalle</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.recipients.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-gray-800">{`${r.customer.firstName ?? ""} ${r.customer.lastName ?? ""}`.trim() || "Sin nombre"}</td>
                      <td className="px-3 py-2"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RSTATUS[r.status].cls}`}>{RSTATUS[r.status].label}</span></td>
                      <td className="px-3 py-2 text-gray-400 text-xs hidden sm:table-cell truncate max-w-[180px]">{r.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.recipients.length >= 300 && <p className="text-[11px] text-gray-400 mt-2">Mostrando los primeros 300 destinatarios.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls?: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-center">
      <p className={`text-xl font-bold ${cls ?? "text-gray-800"}`}>{value}</p>
      <p className="text-[11px] text-gray-400">{label}</p>
    </div>
  );
}
