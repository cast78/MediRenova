"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";

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
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? "Editar regla" : "Nueva regla"}</h2>
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
            <input value="WhatsApp" disabled className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
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

export default function WorkflowPage() {
  const queryClient = useQueryClient();
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

  return (
    <div className="p-6 max-w-5xl">
      {showNew && <RuleModal products={activeProducts} onClose={() => setShowNew(false)} />}
      {editRule && <RuleModal rule={editRule} products={activeProducts} onClose={() => setEditRule(null)} />}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workflow comercial</h1>
          <p className="text-sm text-gray-500 mt-0.5">Avisos automáticos de caducidad por WhatsApp</p>
        </div>
        <button onClick={() => setShowNew(true)} disabled={activeProducts.length === 0}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50">
          + Nueva regla
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Aviso</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Plantilla</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Reintentos</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
            {!isLoading && (!rules || rules.length === 0) && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin reglas de workflow — crea la primera</td></tr>}
            {rules?.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{r.product.name}</td>
                <td className="px-4 py-3 text-gray-600">{r.daysBeforeExpiry} días antes</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.templateName}</td>
                <td className="px-4 py-3 text-gray-600">cada {r.retryEveryDays}d · máx {r.maxRetries}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${r.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {r.active ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => toggle.mutate(r)} disabled={toggle.isPending}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                      {r.active ? "Desactivar" : "Activar"}
                    </button>
                    <button onClick={() => setEditRule(r)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
                    <button onClick={() => remove.mutate(r.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeProducts.length === 0 && (
        <p className="text-xs text-gray-400 mt-3">Necesitas al menos un producto activo para crear reglas.</p>
      )}
    </div>
  );
}
