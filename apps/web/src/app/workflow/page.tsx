"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface WorkflowRule {
  id: string;
  daysBeforeExpiry: number;
  actionType: string;
  templateName: string;
  retryEveryDays: number;
  maxRetries: number;
  active: boolean;
  product: { id: string; name: string };
}

export default function WorkflowPage() {
  const { data: rules, isLoading } = useQuery<WorkflowRule[]>({
    queryKey: ["workflow-rules"],
    queryFn: () => apiFetch<WorkflowRule[]>("/workflow-rules"),
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Workflow Comercial</h1>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Días antes caducidad</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Acción</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Plantilla</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
            {!isLoading && (!rules || rules.length === 0) && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin reglas de workflow</td></tr>}
            {rules?.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{r.product.name}</td>
                <td className="px-4 py-3 text-gray-600">{r.daysBeforeExpiry} días</td>
                <td className="px-4 py-3 text-gray-600">{r.actionType}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.templateName}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${r.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {r.active ? "Activa" : "Inactiva"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
