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

function KpiCard({ label, value, sub, color = "text-gray-800", bg = "bg-white border-gray-200" }: {
  label: string; value: string | number; sub?: string; color?: string; bg?: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${bg}`}>
      <p className="text-xs text-gray-400 font-medium mb-0.5">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
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
    <div className="p-6 max-w-5xl space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Reservas hoy"
          value={summary?.appointmentsToday ?? "—"}
          color="text-gray-800"
        />
        <KpiCard
          label="Reservas esta semana"
          value={summary?.appointmentsWeek ?? "—"}
          color="text-blue-700"
          bg="bg-blue-50 border-blue-100"
        />
        <KpiCard
          label="Revisiones abiertas"
          value={summary?.openRevisions ?? "—"}
          color="text-amber-700"
          bg="bg-amber-50 border-amber-100"
        />
        <KpiCard
          label="Tasa de conversión"
          value={summary ? `${summary.conversionRate}%` : "—"}
          sub="este mes"
          color="text-emerald-700"
          bg="bg-emerald-50 border-emerald-100"
        />
      </div>

      {/* Chart: Reservas por mes */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Reservas por mes — últimos 12 meses</h2>
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
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Próximas caducidades — 90 días</h2>
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{expirations?.length ?? 0} clientes</span>
        </div>
        <div className="divide-y divide-gray-100">
          {!expirations ? (
            [1,2,3,4].map((i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between animate-pulse">
                <div className="space-y-1.5">
                  <div className="h-3 bg-gray-100 rounded w-32" />
                  <div className="h-2.5 bg-gray-100 rounded w-20" />
                </div>
                <div className="h-4 bg-gray-100 rounded w-16" />
              </div>
            ))
          ) : expirations.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin caducidades próximas</p>
          ) : (
            expirations.slice(0, 20).map((exp) => {
              const urgency = exp.daysUntilExpiry <= 30
                ? { text: "text-red-600", bg: "bg-red-50 border-red-100", label: "Urgente" }
                : exp.daysUntilExpiry <= 60
                  ? { text: "text-amber-600", bg: "bg-amber-50 border-amber-100", label: "Próximo" }
                  : { text: "text-gray-600", bg: "bg-gray-50 border-gray-200", label: null };
              return (
                <div key={exp.revisionId} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                  <div className="min-w-0">
                    <Link
                      href={`/customers/${exp.customer.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline truncate block"
                    >
                      {exp.customer.firstName} {exp.customer.lastName}
                    </Link>
                    <p className="text-xs text-gray-400 mt-0.5">{exp.product.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {urgency.label && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${urgency.bg} ${urgency.text}`}>
                        {urgency.label}
                      </span>
                    )}
                    <span className={`text-sm font-semibold tabular-nums ${urgency.text}`}>
                      {exp.daysUntilExpiry}d
                    </span>
                    {exp.hasBooking ? (
                      <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded font-medium">Reservado</span>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded font-medium">Sin reserva</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

