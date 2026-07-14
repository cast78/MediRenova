"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Zap, Package, RefreshCw, CalendarClock, ChevronRight, MessageCircle, Mail, MessageSquare, Pencil, Trash2, Plus, Clock, Info } from "lucide-react";

interface Product {
  id: string;
  name: string;
  active: boolean;
}

interface WorkflowRule {
  id: string;
  productId: string;
  daysBeforeExpiry: number;
  actionType: string;
  templateName: string;
  retryEveryDays: number;
  maxRetries: number;
  active: boolean;
  product: { id: string; name: string };
}

const DEFAULT_TEMPLATE = "medirenova_renewal_reminder";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (e && typeof e === "object" && !Array.isArray(e)) {
      const msgs = Object.values(e as Record<string, string[]>).flat().filter(Boolean);
      if (msgs.length) return msgs.join(" · ");
    }
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : "Error al guardar";
}

// ── Modal ───────────────────────────────────────────────────────────────────────

interface RuleForm {
  productId: string;
  daysBeforeExpiry: string;
  templateName: string;
  retryEveryDays: string;
  maxRetries: string;
}

function RuleModal({ rule, products, onClose }: { rule?: WorkflowRule; products: Product[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RuleForm>(
    rule
      ? {
          productId: rule.productId,
          daysBeforeExpiry: String(rule.daysBeforeExpiry),
          templateName: rule.templateName,
          retryEveryDays: String(rule.retryEveryDays),
          maxRetries: String(rule.maxRetries),
        }
      : { productId: products[0]?.id ?? "", daysBeforeExpiry: "30", templateName: DEFAULT_TEMPLATE, retryEveryDays: "15", maxRetries: "3" },
  );
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!rule;

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        productId: form.productId,
        daysBeforeExpiry: parseInt(form.daysBeforeExpiry, 10),
        actionType: "WHATSAPP",
        templateName: form.templateName.trim(),
        retryEveryDays: parseInt(form.retryEveryDays, 10),
        maxRetries: parseInt(form.maxRetries, 10),
      };
      return isEdit
        ? apiFetch(`/workflow-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch("/workflow-rules", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["workflow-rules"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start gap-3 mb-4">
          <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-blue-600" /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">{isEdit ? "Editar regla" : "Nueva regla"}</h2>
            <p className="text-xs text-gray-500">Aviso de renovación automático por WhatsApp</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Producto *</label>
            <select required value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Seleccionar —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Días antes de caducidad *</label>
            <input type="number" min={1} max={365} required value={form.daysBeforeExpiry}
              onChange={(e) => setForm((f) => ({ ...f, daysBeforeExpiry: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-1.5 mt-1.5">
              {[90, 60, 30].map((d) => (
                <button key={d} type="button" onClick={() => setForm((f) => ({ ...f, daysBeforeExpiry: String(d) }))}
                  className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-500">{d} días</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Canal</label>
            <div className="grid grid-cols-3 gap-2">
              {/* WhatsApp: único canal proactivo disponible (plantilla aprobada por Meta). */}
              <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-blue-500 bg-blue-50 px-2 py-2.5 text-blue-700">
                <MessageCircle className="w-[18px] h-[18px]" />
                <span className="text-xs font-medium">WhatsApp</span>
                <span className="text-[10px] text-blue-600/80">Activo</span>
              </div>
              {/* Email: pendiente de conectar proveedor (Resend). */}
              <div title="Se activará al conectar el proveedor de email (Resend)"
                className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2 py-2.5 text-gray-400 cursor-not-allowed">
                <Mail className="w-[18px] h-[18px]" />
                <span className="text-xs font-medium">Email</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">Pronto</span>
              </div>
              {/* SMS: pendiente de contratar proveedor de SMS. */}
              <div title="Se activará al contratar un proveedor de SMS"
                className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2 py-2.5 text-gray-400 cursor-not-allowed">
                <MessageSquare className="w-[18px] h-[18px]" />
                <span className="text-xs font-medium">SMS</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">Pronto</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0" /> Email y SMS se activarán al conectar sus proveedores.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Plantilla aprobada (Meta) *</label>
            <input required value={form.templateName} onChange={(e) => setForm((f) => ({ ...f, templateName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reintentar cada (días)</label>
              <input type="number" min={1} value={form.retryEveryDays} onChange={(e) => setForm((f) => ({ ...f, retryEveryDays: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Máx. reintentos</label>
              <input type="number" min={0} value={form.maxRetries} onChange={(e) => setForm((f) => ({ ...f, maxRetries: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          {/* Vista previa del flujo (se actualiza al configurar) */}
          <div className="pt-1">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Vista previa del flujo</label>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
              <FlowStep icon={CalendarClock} circle="bg-amber-50" color="text-amber-700" title={`${form.daysBeforeExpiry || "?"} días antes`} sub="de caducar" />
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <FlowStep icon={MessageCircle} circle="bg-emerald-50" color="text-emerald-700" title="WhatsApp" sub={form.templateName.trim() || "(plantilla)"} mono />
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <FlowStep icon={RefreshCw} circle="bg-blue-50" color="text-blue-700"
                title={(parseInt(form.maxRetries, 10) || 0) > 0 ? `Cada ${form.retryEveryDays || "?"} d` : "Sin reintentos"}
                sub={(parseInt(form.maxRetries, 10) || 0) > 0 ? `hasta ${form.maxRetries}` : "un solo envío"} />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5"><Info className="w-3 h-3 inline align-[-1px]" /> {products.find((p) => p.id === form.productId)?.name ? `Para «${products.find((p) => p.id === form.productId)!.name}» · ` : ""}se ejecuta a diario y se salta a quien ya tenga cita.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? "Guardando..." : isEdit ? "Guardar" : "Crear regla"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Un paso del flujo de la regla (círculo con icono + título + subtítulo).
function FlowStep({ icon: Icon, circle, color, title, sub, mono }: { icon: typeof Zap; circle: string; color: string; title: string; sub: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 flex-1 min-w-0">
      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${circle}`}><Icon className={`w-[17px] h-[17px] ${color}`} /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-900 truncate">{title}</p>
        <p className={`text-[11px] text-gray-500 truncate ${mono ? "font-mono" : ""}`}>{sub}</p>
      </div>
    </div>
  );
}

export default function WorkflowPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [showNew, setShowNew] = useState(false);
  const [editRule, setEditRule] = useState<WorkflowRule | null>(null);

  const { data: rules, isLoading } = useQuery<WorkflowRule[]>({
    queryKey: ["workflow-rules"],
    queryFn: () => apiFetch<WorkflowRule[]>("/workflow-rules"),
  });
  const { data: products } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => apiFetch<Product[]>("/products"),
  });
  const activeProducts = (products ?? []).filter((p) => p.active);

  const toggle = useMutation({
    mutationFn: (r: WorkflowRule) => apiFetch(`/workflow-rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: !r.active }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workflow-rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/workflow-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workflow-rules"] }),
  });

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-5xl">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Workflow</h1>
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4">Esta sección es solo para administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      {showNew && <RuleModal products={activeProducts} onClose={() => setShowNew(false)} />}
      {editRule && <RuleModal rule={editRule} products={activeProducts} onClose={() => setEditRule(null)} />}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workflow</h1>
          <p className="text-sm text-gray-500 mt-0.5">Avisos de renovación que se envían solos según la caducidad</p>
        </div>
        <button onClick={() => setShowNew(true)} disabled={activeProducts.length === 0}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Nueva regla
        </button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between"><span className="text-[11px] text-gray-400">Reglas activas</span><Zap className="w-3.5 h-3.5 text-gray-400" /></div>
          <p className="text-2xl font-bold text-gray-800 mt-0.5">{(rules ?? []).filter((r) => r.active).length}<span className="text-sm font-normal text-gray-400 ml-1">/{(rules ?? []).length}</span></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between"><span className="text-[11px] text-gray-400">Productos cubiertos</span><Package className="w-3.5 h-3.5 text-gray-400" /></div>
          <p className="text-2xl font-bold text-gray-800 mt-0.5">{new Set((rules ?? []).map((r) => r.productId)).size}<span className="text-sm font-normal text-gray-400 ml-1">/{activeProducts.length}</span></p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 px-4 py-3">
          <div className="flex items-center justify-between"><span className="text-[11px] text-blue-600">Frecuencia</span><Clock className="w-3.5 h-3.5 text-blue-500" /></div>
          <p className="text-lg font-bold text-blue-700 mt-1.5">Revisión diaria</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Cargando…</p>}
      {!isLoading && (!rules || rules.length === 0) && (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">Sin reglas — crea la primera para avisar de renovaciones sin hacer nada.</p>
        </div>
      )}

      <div className="space-y-3">
        {rules?.map((r) => (
          <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="inline-flex items-center gap-2 font-medium text-gray-900 min-w-0"><Package className="w-4 h-4 text-gray-400 shrink-0" /><span className="truncate">{r.product.name}</span></span>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${r.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{r.active ? "Activa" : "Inactiva"}</span>
                <button onClick={() => toggle.mutate(r)} disabled={toggle.isPending} aria-label={r.active ? "Desactivar" : "Activar"} className={`relative w-8 h-[18px] rounded-full transition-colors ${r.active ? "bg-blue-600" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${r.active ? "right-0.5" : "left-0.5"}`} />
                </button>
                <button onClick={() => setEditRule(r)} title="Editar" aria-label="Editar" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove.mutate(r.id)} title="Eliminar" aria-label="Eliminar" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
              <FlowStep icon={CalendarClock} circle="bg-amber-50" color="text-amber-700" title={`${r.daysBeforeExpiry} días antes`} sub="de caducar" />
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <FlowStep icon={MessageCircle} circle="bg-emerald-50" color="text-emerald-700" title="Enviar por WhatsApp" sub={r.templateName} mono />
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <FlowStep icon={RefreshCw} circle="bg-blue-50" color="text-blue-700" title={r.maxRetries > 0 ? `Reintenta cada ${r.retryEveryDays} d` : "Sin reintentos"} sub={r.maxRetries > 0 ? `hasta ${r.maxRetries} veces` : "un solo envío"} />
            </div>
            <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1.5"><Info className="w-3 h-3 shrink-0" /> Se salta a quien ya tenga una cita de renovación reservada.</p>
          </div>
        ))}
      </div>

      {activeProducts.length === 0 && (
        <p className="text-xs text-gray-400 mt-3">Necesitas al menos un producto activo para crear reglas.</p>
      )}
    </div>
  );
}
