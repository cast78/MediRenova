"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Builder, type FormTemplate, type Product } from "@/components/form-builder";
import { FileText, CheckCircle2, Pencil, Trash2, Plus, ListChecks } from "lucide-react";

export default function FormsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Producto inicial desde la URL (?product=…, p.ej. al venir desde Productos).
  const [productId, setProductId] = useState(searchParams.get("product") ?? "");
  const [builder, setBuilder] = useState<{ editing: FormTemplate | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: products } = useQuery<Product[]>({ queryKey: ["products"], queryFn: () => apiFetch<Product[]>("/products") });
  const activeProducts = (products ?? []).filter((p) => p.active);
  const pid = productId || activeProducts[0]?.id || "";

  // Refleja el producto elegido en la URL para conservar el contexto (refresco/volver).
  useEffect(() => {
    if (!pid) return;
    router.replace(`/forms?product=${pid}`, { scroll: false });
  }, [pid, router]);

  const { data: forms, isLoading } = useQuery<FormTemplate[]>({
    queryKey: ["forms", pid],
    queryFn: () => apiFetch<FormTemplate[]>(`/products/${pid}/forms`),
    enabled: !!pid,
  });
  // Orden por versión descendente: la más reciente arriba, el recorrido de versiones debajo.
  const sorted = [...(forms ?? [])].sort((a, b) => b.version - a.version);

  const activate = useMutation({
    mutationFn: (id: string) => apiFetch(`/forms/${id}/activate`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forms", pid] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/forms/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["forms", pid] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Formularios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Diseña los formularios de revisión por producto</p>
        </div>
        <div className="flex items-center gap-2.5">
          <select value={pid} onChange={(e) => { setProductId(e.target.value); setBuilder(null); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {activeProducts.length === 0 && <option value="">Sin productos</option>}
            {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!builder && pid && (
            <button onClick={() => setBuilder({ editing: null })}
              className="px-3.5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium inline-flex items-center gap-1.5 shrink-0">
              <Plus className="w-4 h-4" /> Nuevo formulario
            </button>
          )}
        </div>
      </div>

      {builder ? (
        <Builder productId={pid} productName={activeProducts.find((p) => p.id === pid)?.name} editing={builder.editing} onClose={() => setBuilder(null)} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Formulario</th>
                <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Versión</th>
                <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Campos</th>
                <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Estado</th>
                <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center">
                  <FileText className="w-7 h-7 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Sin formularios todavía — crea el primero</p>
                </td></tr>
              )}
              {sorted.map((f) => (
                <tr key={f.id} onClick={() => setBuilder({ editing: f })}
                  style={f.isActive ? { boxShadow: "inset 3px 0 0 #10b981" } : undefined}
                  className={`cursor-pointer transition-colors ${f.isActive ? "bg-emerald-50/40 hover:bg-emerald-50" : "hover:bg-gray-50"}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${f.isActive ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>
                        <FileText className="w-4 h-4" />
                      </span>
                      <span className="font-medium text-gray-900">{f.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">v{f.version}</span></td>
                  <td className="px-4 py-2.5 text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5 text-gray-400" />{f.schema.fields?.length ?? 0}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {f.isActive
                      ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />Activo</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Borrador</span>}
                  </td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 justify-end">
                      {!f.isActive && (
                        <button onClick={() => activate.mutate(f.id)} disabled={activate.isPending}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />Activar
                        </button>
                      )}
                      <button onClick={() => setBuilder({ editing: f })} title="Editar" aria-label="Editar"
                        className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"><Pencil className="w-4 h-4" /></button>
                      {confirmDelete === f.id ? (
                        <>
                          <button onClick={() => setConfirmDelete(null)}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">Cancelar</button>
                          <button onClick={() => remove.mutate(f.id)} disabled={remove.isPending}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 font-medium">Confirmar</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelete(f.id)} title="Eliminar" aria-label="Eliminar"
                          className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
