"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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

interface MonthlyData {
  month: string;
  count: number;
}

const MONTH_LABELS: Record<string, string> = {
  "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic",
};

function formatMonth(month: string): string {
  const [, m] = month.split("-");
  return MONTH_LABELS[m ?? ""] ?? month;
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

  const { data: chartData } = useQuery<MonthlyData[]>({
    queryKey: ["dashboard-chart-monthly"],
    queryFn: () => apiFetch<MonthlyData[]>("/dashboard/charts/appointments-by-month"),
  });

  const formattedChart = (chartData ?? []).map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Reservas hoy" value={summary?.appointmentsToday ?? "—"} />
        <KpiCard label="Reservas esta semana" value={summary?.appointmentsWeek ?? "—"} />
        <KpiCard label="Revisiones abiertas" value={summary?.openRevisions ?? "—"} />
        <KpiCard label="Tasa conversión" value={summary ? `${summary.conversionRate}%` : "—"} sub="este mes" />
      </div>

      {/* Chart: Reservas por mes */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium text-gray-900 mb-4">Reservas por mes (últimos 12 meses)</h2>
        {formattedChart.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">Sin datos</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={formattedChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
                formatter={(v: number) => [v, "Reservas"]}
                labelFormatter={(l) => `Mes: ${l}`}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Upcoming expirations */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Próximas caducidades (90 días)</h2>
          <span className="text-xs text-gray-400">{expirations?.length ?? 0} clientes</span>
        </div>
        <div className="divide-y divide-gray-50">
          {!expirations || expirations.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin caducidades próximas</p>
          ) : (
            expirations.slice(0, 20).map((exp) => (
              <div key={exp.revisionId} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <Link
                    href={`/customers/${exp.customer.id}`}
                    className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline"
                  >
                    {exp.customer.firstName} {exp.customer.lastName}
                  </Link>
                  <p className="text-xs text-gray-500">{exp.product.name}</p>
                </div>
                <div className="text-right flex flex-col items-end gap-1">
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

