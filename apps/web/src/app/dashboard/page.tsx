"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface DashboardSummary {
  appointmentsToday: number;
  appointmentsWeek: number;
  openRevisions: number;
  conversionRate: number;
}

interface Expiration {
  revisionId: string;
  expiryDate: string;
  daysUntilExpiry: number;
  hasBooking: boolean;
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null };
  product: { id: string; name: string };
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: summary } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary"),
  });

  const { data: expirations } = useQuery<Expiration[]>({
    queryKey: ["dashboard-expirations"],
    queryFn: () => apiFetch<Expiration[]>("/dashboard/expirations"),
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Reservas hoy" value={summary?.appointmentsToday ?? "—"} />
        <KpiCard label="Reservas esta semana" value={summary?.appointmentsWeek ?? "—"} />
        <KpiCard label="Revisiones abiertas" value={summary?.openRevisions ?? "—"} />
        <KpiCard label="Tasa conversión" value={summary ? `${summary.conversionRate}%` : "—"} sub="este mes" />
      </div>

      {/* Upcoming expirations */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-medium text-gray-900">Próximas caducidades (90 días)</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {!expirations || expirations.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin caducidades próximas</p>
          ) : (
            expirations.slice(0, 20).map((exp) => (
              <div key={exp.revisionId} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {exp.customer.firstName} {exp.customer.lastName}
                  </p>
                  <p className="text-xs text-gray-500">{exp.product.name}</p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-medium ${
                      exp.daysUntilExpiry <= 30
                        ? "text-red-600"
                        : exp.daysUntilExpiry <= 60
                          ? "text-amber-600"
                          : "text-gray-600"
                    }`}
                  >
                    {exp.daysUntilExpiry} días
                  </p>
                  {exp.hasBooking ? (
                    <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Reservado</span>
                  ) : (
                    <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Sin reserva</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
