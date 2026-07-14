"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { NewCustomerModal } from "@/components/new-customer-modal";
import { Search, UserPlus, Users, Mail, Phone, MailX, PhoneOff, ChevronRight } from "lucide-react";

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

interface CustomerStats {
  total: number;
  new30d: number;
  withEmail: number;
  withPhone: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(first: string | null, last: string | null) {
  const a = (first ?? "")[0] ?? "";
  const b = (last ?? "")[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

// KPI con icono + tinte (mismo lenguaje que Revisiones/Visitas). El valor es global.
type KpiTone = "neutral" | "green" | "blue" | "violet";
const KPI_TONES: Record<KpiTone, { bg: string; label: string; num: string }> = {
  neutral: { bg: "bg-white border-gray-200", label: "text-gray-500", num: "text-gray-900" },
  green: { bg: "bg-emerald-50 border-emerald-100", label: "text-emerald-700", num: "text-emerald-700" },
  blue: { bg: "bg-blue-50 border-blue-100", label: "text-blue-700", num: "text-blue-700" },
  violet: { bg: "bg-violet-50 border-violet-100", label: "text-violet-700", num: "text-violet-700" },
};
function Kpi({ icon: Icon, label, value, sub, tone }: {
  icon: typeof Users; label: string; value: React.ReactNode; sub?: string | undefined; tone: KpiTone;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className={`border rounded-xl px-4 py-3 ${t.bg}`}>
      <p className={`text-xs flex items-center gap-1.5 ${t.label}`}><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 ${t.num}`}>
        {value}{sub && <span className="text-xs font-normal ml-1.5 opacity-70">{sub}</span>}
      </p>
    </div>
  );
}

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Estado inicial desde la URL: al abrir un cliente y volver (router.back) se
  // recupera la búsqueda y la página en la que estabas.
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [showModal, setShowModal] = useState(false);

  // Debounce search input (resetea a página 1 al buscar).
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); if (q !== debouncedQ) setPage(1); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Refleja búsqueda + página en la URL (reemplaza, sin ensuciar el historial).
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (page > 1) p.set("page", String(page));
    router.replace(`/customers${p.toString() ? `?${p.toString()}` : ""}`, { scroll: false });
  }, [debouncedQ, page, router]);

  const queryParams = new URLSearchParams({ page: String(page), limit: "20" });
  if (debouncedQ) queryParams.set("q", debouncedQ);

  const { data, isLoading } = useQuery<{
    data: Customer[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["customers", debouncedQ, page],
    queryFn: () => apiFetch(`/customers?${queryParams.toString()}`, { raw: true }),
  });

  const { data: stats } = useQuery<CustomerStats>({
    queryKey: ["customers-stats"],
    queryFn: () => apiFetch<CustomerStats>("/customers/stats"),
    staleTime: 60_000,
  });

  return (
    <div className="p-6 max-w-5xl">
      {showModal && <NewCustomerModal onClose={() => setShowModal(false)} />}

      {/* Header: título (izq) · búsqueda + acción (der) */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Base de pacientes y su contactabilidad</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative w-64 max-w-[60vw]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar nombre, email o teléfono…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="px-3.5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium inline-flex items-center gap-1.5 shrink-0"
          >
            <UserPlus className="w-4 h-4" /> Nuevo cliente
          </button>
        </div>
      </div>

      {/* KPIs globales (toda la cartera del centro/tenant, no la página) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Kpi icon={Users} label="Total clientes" tone="neutral" value={stats ? stats.total.toLocaleString("es-ES") : "—"} />
        <Kpi icon={UserPlus} label="Nuevos (30 días)" tone="green" value={stats ? stats.new30d.toLocaleString("es-ES") : "—"} />
        <Kpi icon={Mail} label="Con email" tone="blue"
          value={stats ? stats.withEmail.toLocaleString("es-ES") : "—"}
          sub={stats ? pct(stats.withEmail, stats.total) : undefined} />
        <Kpi icon={Phone} label="Con teléfono" tone="violet"
          value={stats ? stats.withPhone.toLocaleString("es-ES") : "—"}
          sub={stats ? pct(stats.withPhone, stats.total) : undefined} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-1.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Cliente</th>
              <th className="text-left px-4 py-1.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-1.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Teléfono</th>
              <th className="text-left px-4 py-1.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Alta</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              [1,2,3,4].map((i) => (
                <tr key={i}>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-3 animate-pulse">
                      <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />
                      <div className="h-3 bg-gray-100 rounded w-32" />
                    </div>
                  </td>
                  <td className="px-4 py-1.5"><div className="h-3 bg-gray-100 rounded w-40 animate-pulse" /></td>
                  <td className="px-4 py-1.5"><div className="h-3 bg-gray-100 rounded w-24 animate-pulse" /></td>
                  <td className="px-4 py-1.5"><div className="h-3 bg-gray-100 rounded w-20 animate-pulse" /></td>
                  <td className="px-4 py-1.5" />
                </tr>
              ))
            )}
            {!isLoading && (!data?.data || data.data.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                {debouncedQ ? `Sin resultados para "${debouncedQ}"` : "Sin clientes registrados"}
              </td></tr>
            )}
            {data?.data.map((c) => {
              const fullName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
              const color = avatarColor(fullName);
              const initials = getInitials(c.firstName, c.lastName);
              return (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer transition-colors group" onClick={() => router.push(`/customers/${c.id}`)}>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {initials}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{fullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-sm">
                    {c.email
                      ? <span className="text-gray-600 inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />{c.email}</span>
                      : <span className="text-gray-300 inline-flex items-center gap-1.5"><MailX className="w-3.5 h-3.5" />sin email</span>}
                  </td>
                  <td className="px-4 py-1.5 text-sm">
                    {c.phone
                      ? <span className="text-gray-600 inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />{c.phone}</span>
                      : <span className="text-gray-300 inline-flex items-center gap-1.5"><PhoneOff className="w-3.5 h-3.5" />sin teléfono</span>}
                  </td>
                  <td className="px-4 py-1.5 text-sm text-gray-500">{new Date(c.createdAt).toLocaleDateString("es-ES")}</td>
                  <td className="px-2 py-1.5 text-gray-300 group-hover:text-gray-500"><ChevronRight className="w-4 h-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {data && data.meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              {data.meta.total.toLocaleString("es-ES")} cliente{data.meta.total === 1 ? "" : "s"}
              {data.meta.pages > 1 ? ` · página ${data.meta.page} de ${data.meta.pages}` : ""}
            </p>
            {data.meta.pages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
                <button onClick={() => setPage((p) => Math.min(data.meta.pages, p + 1))} disabled={page === data.meta.pages} className="px-3 py-1.5 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente →</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
