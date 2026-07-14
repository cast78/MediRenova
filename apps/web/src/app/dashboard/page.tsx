"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useAppContext } from "@/components/context-bar";
import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Percent,
  MessagesSquare,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
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

interface ExpirationSummary {
  le30: number;
  d31_60: number;
  d61_90: number;
  total: number;
  noBooking: number;
}

interface MonthlyData {
  month: string;
  count: number;
}

interface ProvinceData {
  province: string;
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

// KPI con icono. tone controla el color de fondo/texto; "plain" = tarjeta neutra blanca.
function KpiCard({ icon: Icon, label, value, sub, tone = "plain" }: {
  icon: typeof CalendarDays; label: string; value: string | number; sub?: string | undefined;
  tone?: "plain" | "accent" | "warning" | "success";
}) {
  const tones = {
    plain: "bg-white border-gray-200 text-gray-800",
    accent: "bg-blue-50 border-blue-100 text-blue-700",
    warning: "bg-amber-50 border-amber-100 text-amber-700",
    success: "bg-emerald-50 border-emerald-100 text-emerald-700",
  }[tone];
  const labelColor = tone === "plain" ? "text-gray-500" : "";
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones}`}>
      <p className={`text-xs font-medium mb-0.5 flex items-center gap-1.5 ${labelColor}`}>
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-[10px] opacity-70 mt-0.5">{sub}</p>}
    </div>
  );
}

// Tarjeta de tramo de caducidad. featured resalta "Sin reserva" con borde y enlace.
function ExpiryCard({ label, value, note, tone, href }: {
  label: string; value: number | string; note?: string; tone: "danger" | "warning" | "neutral";
  href?: string;
}) {
  const styles = {
    danger: { box: "bg-red-50 border-red-100", text: "text-red-600" },
    warning: { box: "bg-amber-50 border-amber-100", text: "text-amber-600" },
    neutral: { box: "bg-white border-gray-200", text: "text-gray-800" },
  }[tone];
  const inner = (
    <>
      <p className={`text-xs font-medium flex items-center gap-1.5 ${tone === "neutral" ? "text-gray-500" : styles.text}`}>
        {href && <AlertTriangle className="w-3.5 h-3.5" />} {label}
      </p>
      <p className={`text-2xl font-bold mt-1 ${styles.text}`}>{value}</p>
      {note && (
        <p className={`text-[10px] mt-0.5 flex items-center gap-1 ${tone === "neutral" ? "text-gray-400" : styles.text} opacity-90`}>
          {note} {href && <ArrowRight className="w-3 h-3" />}
        </p>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`rounded-xl border-2 border-red-200 px-4 py-3 block transition-colors hover:bg-red-100/60 ${styles.box}`}>
        {inner}
      </Link>
    );
  }
  return <div className={`rounded-xl border px-4 py-3 ${styles.box}`}>{inner}</div>;
}

export default function DashboardPage() {
  const { centerId } = useAppContext(); // centro elegido en la barra superior
  const cq = centerId ? `?centerId=${centerId}` : "";

  const { data: summary } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary", centerId],
    queryFn: () => apiFetch<DashboardSummary>(`/dashboard/summary${cq}`),
  });

  const { data: expiry } = useQuery<ExpirationSummary>({
    queryKey: ["dashboard-expirations-summary", centerId],
    queryFn: () => apiFetch<ExpirationSummary>(`/dashboard/expirations/summary${cq}`),
  });

  const { data: chartData } = useQuery<MonthlyData[]>({
    queryKey: ["dashboard-chart-monthly", centerId],
    queryFn: () => apiFetch<MonthlyData[]>(`/dashboard/charts/appointments-by-month${cq}`),
  });

  const { data: provinceData } = useQuery<ProvinceData[]>({
    queryKey: ["dashboard-chart-province"],
    queryFn: () => apiFetch<ProvinceData[]>("/dashboard/charts/customers-by-province"),
  });

  // Comunicaciones a clientes (avisos/recordatorios) — tenant-wide, no por centro.
  const { data: comms } = useQuery<{ sent: number; responses: number; responseRate: number | null }>({
    queryKey: ["dashboard-communications"],
    queryFn: () => apiFetch(`/dashboard/communications`),
  });

  const formattedChart = (chartData ?? []).map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }));
  const topProvinces = (provinceData ?? []).slice(0, 6);
  const dash = "—";

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>

      {/* KPIs operativos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={CalendarDays} label="Reservas hoy" value={summary?.appointmentsToday ?? dash} />
        <KpiCard icon={CalendarRange} label="Esta semana" value={summary?.appointmentsWeek ?? dash} tone="accent" />
        <KpiCard icon={ClipboardList} label="Revisiones abiertas" value={summary?.openRevisions ?? dash} tone="warning" />
        <KpiCard icon={Percent} label="Conversión" value={summary ? `${summary.conversionRate}%` : dash} sub="este mes" tone="success" />
      </div>

      {/* Caducidades próximas */}
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-sm font-medium text-gray-600">Caducidades próximas · 90 días</h2>
          <span className="text-[11px] text-gray-400">{centerId ? "centro seleccionado" : "todos los centros"}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ExpiryCard label="≤ 30 días" value={expiry?.le30 ?? dash} note="urgente" tone="danger" />
          <ExpiryCard label="31–60 días" value={expiry?.d31_60 ?? dash} note="próximo" tone="warning" />
          <ExpiryCard label="61–90 días" value={expiry?.d61_90 ?? dash} note="seguimiento" tone="neutral" />
          <ExpiryCard label="Sin reserva" value={expiry?.noBooking ?? dash} note="requieren aviso" tone="danger" href="/revisions" />
        </div>
      </div>

      {/* Comunicaciones — tira compacta (dato secundario) */}
      <div className="flex items-center gap-x-3 gap-y-1 bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-xs flex-wrap">
        <span className="text-gray-600 font-medium flex items-center gap-1.5">
          <MessagesSquare className="w-4 h-4 text-gray-400" /> Comunicaciones · este mes
        </span>
        <span className="text-gray-400 hidden sm:inline">·</span>
        <span className="text-gray-500"><b className="font-semibold text-gray-800">{comms?.sent ?? dash}</b> avisos</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500"><b className="font-semibold text-gray-800">{comms?.responses ?? dash}</b> respuestas</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">
          <b className="font-semibold text-gray-800">{comms ? (comms.responseRate === null ? dash : `${comms.responseRate}%`) : dash}</b> tasa
        </span>
        <span className="text-[11px] text-gray-400 ml-auto">todos los centros</span>
      </div>

      {/* Gráficos — misma fila */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Reservas por mes */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Reservas por mes — 12 meses</h2>
          {formattedChart.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">Sin datos</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={formattedChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
                  formatter={(v: number) => [v, "Reservas"]}
                  labelFormatter={(l) => `Mes: ${l}`}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Clientes por provincia */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Clientes por provincia</h2>
          {topProvinces.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">Sin datos</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topProvinces} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="province" width={96} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
                  formatter={(v: number) => [v, "Clientes"]}
                />
                <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
