"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Builder, type FormTemplate, type Product } from "@/components/form-builder";

export default function FormsPage() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [builder, setBuilder] = useState<{ editing: FormTemplate | null } | null>(null);

  // Preselecciona el producto al venir desde la pestaña Productos (?product=...)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("product");
    if (p) setProductId(p);
  }, []);

  const { data: products } = useQuery<Product[]>({ queryKey: ["products"], queryFn: () => apiFetch<Product[]>("/products") });
  const activeProducts = (products ?? []).filter((p) => p.active);
  const pid = productId || activeProducts[0]?.id || "";

  const { data: forms, isLoading } = useQuery<FormTemplate[]>({
    queryKey: ["forms", pid],
    queryFn: () => apiFetch<FormTemplate[]>(`/products/${pid}/forms`),
    enabled: !!pid,
  });

  const activate = useMutation({
    mutationFn: (id: string) => apiFetch(`/forms/${id}/activate`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["forms", pid] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/forms/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["forms", pid] }),
  });

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Formularios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Diseña los formularios de revisión por producto</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={pid} onChange={(e) => { setProductId(e.target.value); setBuilder(null); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {activeProducts.length === 0 && <option value="">Sin productos</option>}
            {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!builder && pid && (
            <button onClick={() => setBuilder({ editing: null })} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">+ Nuevo formulario</button>
          )}
        </div>
      </div>

      {builder ? (
        <Builder productId={pid} editing={builder.editing} onClose={() => setBuilder(null)} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Versión</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Campos</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
              {!isLoading && (!forms || forms.length === 0) && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin formularios — crea el primero</td></tr>}
              {forms?.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{f.name}</td>
                  <td className="px-4 py-3 text-gray-600">v{f.version}</td>
                  <td className="px-4 py-3 text-gray-600">{f.schema.fields?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${f.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{f.isActive ? "Activo" : "Borrador"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {!f.isActive && <button onClick={() => activate.mutate(f.id)} disabled={activate.isPending} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Activar</button>}
                      <button onClick={() => setBuilder({ editing: f })} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
                      <button onClick={() => remove.mutate(f.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Eliminar</button>
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
