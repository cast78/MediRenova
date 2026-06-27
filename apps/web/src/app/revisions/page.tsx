"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface RevisionRow {
  id: string;
  outcome: string;
  completedAt: string | null;
  expiryDate: string | null;
  appointment: {
    scheduledAt: string;
    customer: { id: string; firstName: string | null; lastName: string | null };
    product: { id: string; name: string };
  };
}

type Filter = "all" | "PENDING" | "APTO" | "NO_APTO";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "PENDING", label: "Pendientes" },
  { key: "APTO", label: "Aptas" },
  { key: "NO_APTO", label: "No aptas" },
];

function outcomeBadge(outcome: string) {
  if (outcome === "APTO") return <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-50 text-green-700">Apto</span>;
  if (outcome === "NO_APTO") return <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-50 text-red-700">No apto</span>;
  return <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-50 text-amber-700">Pendiente</span>;
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

export default function RevisionsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [date, setDate] = useState("");

  const { data: revisions, isLoading } = useQuery<RevisionRow[]>({
    queryKey: ["revisions", filter, date],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("outcome", filter);
      if (date) params.set("date", date);
      return apiFetch<RevisionRow[]>(`/revisions?${params.toString()}`);
    },
  });

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Revisiones médicas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Historial de revisiones y certificados</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${filter === f.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha cita</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Caducidad</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
            {!isLoading && (!revisions || revisions.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin revisiones</td></tr>
            )}
            {revisions?.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{r.appointment.customer.firstName} {r.appointment.customer.lastName}</td>
                <td className="px-4 py-3 text-gray-600">{r.appointment.product.name}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(r.appointment.scheduledAt)}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(r.expiryDate)}</td>
                <td className="px-4 py-3">{outcomeBadge(r.outcome)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/revisions/${r.id}`} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-blue-600 font-medium">
                    Abrir →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
