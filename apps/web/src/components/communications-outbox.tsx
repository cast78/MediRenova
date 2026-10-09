"use client";

// Bandeja global de comunicaciones (Configuración → Comunicaciones): KPIs del
// periodo, filtros y tabla de todos los avisos de la clínica (crm-mensajeria).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Search, FlaskConical, Bot, UserCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ChannelIcon, StatusChip, CHANNEL_LABEL, fmtWhen, type Delivery, type DeliveryChannel, type DeliveryStatus } from "./customer-communications";

interface Summary { total: number; byChannel: Record<DeliveryChannel, number>; byStatus: Record<DeliveryStatus, number>; simulated: number }

type Period = "today" | "7d" | "30d";

const EVENTS: { key: string; label: string }[] = [
  { key: "appointment_created", label: "Cita creada" },
  { key: "appointment_rescheduled", label: "Cita reprogramada" },
  { key: "confirmation_requested", label: "Pedir confirmación" },
  { key: "noshow_invite", label: "No-show · invitación" },
  { key: "renewal_reminder", label: "Renovación" },
  { key: "portal_access", label: "Acceso al portal" },
];

function periodFrom(p: Period): string {
  const d = new Date();
  if (p === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (p === "7d" ? 7 : 30));
  return d.toISOString();
}

const SEL = "inline-flex items-center gap-1.5 text-[13px] px-2.5 py-2 rounded-[10px] border border-gray-200 bg-white text-gray-700 min-h-[38px]";

export function CommunicationsOutbox() {
  const [period, setPeriod] = useState<Period>("today");
  const [channel, setChannel] = useState<"ALL" | DeliveryChannel>("ALL");
  const [event, setEvent] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const from = useMemo(() => periodFrom(period), [period]);

  const { data: summary } = useQuery<Summary>({
    queryKey: ["deliveries-summary", from],
    queryFn: () => apiFetch<Summary>(`/deliveries/summary?from=${encodeURIComponent(from)}`),
  });
  const params = new URLSearchParams({ from, limit: "200" });
  if (channel !== "ALL") params.set("channel", channel);
  if (event) params.set("event", event);
  if (status) params.set("status", status);
  if (q.trim()) params.set("q", q.trim());
  const { data: rows, isLoading } = useQuery<Delivery[]>({
    queryKey: ["deliveries", params.toString()],
    queryFn: () => apiFetch<Delivery[]>(`/deliveries?${params.toString()}`),
  });

  const s = summary;
  const delivered = (s?.byStatus.DELIVERED ?? 0) + (s?.byStatus.READ ?? 0);
  const pct = s && s.total > 0 ? Math.round((delivered / s.total) * 100) : 0;
  const periodLabel = period === "today" ? "Hoy" : period === "7d" ? "7 días" : "30 días";

  const chip = (k: "ALL" | DeliveryChannel, label: string) => (
    <button key={k} type="button" onClick={() => setChannel(k)}
      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${channel === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900">Comunicaciones</h2>
          <p className="text-sm text-gray-500">Todo lo que el sistema ha redactado para los pacientes: qué, por dónde, cuándo y si llegó.</p>
        </div>
        {s && s.simulated > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            <FlaskConical className="w-3 h-3" /> Modo demo · nada se envía
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Kpi label={`${periodLabel} · generados`} value={s?.total ?? 0} sub={s ? `${s.byChannel.WHATSAPP} WhatsApp · ${s.byChannel.EMAIL} email · ${s.byChannel.SMS} SMS` : ""} cls="bg-white border-gray-200" lab="text-gray-500" val="text-gray-900" />
        <Kpi label="Entregados" value={delivered} sub={s && s.simulated > 0 && delivered === 0 ? "se informará con proveedor real" : `${pct} %`} cls="bg-blue-50 border-blue-200" lab="text-blue-700" val="text-blue-900" />
        <Kpi label="Leídos" value={s?.byStatus.READ ?? 0} sub="solo WhatsApp informa lectura" cls="bg-emerald-50 border-emerald-200" lab="text-emerald-700" val="text-emerald-900" />
        <Kpi label="Omitidos" value={s?.byStatus.SKIPPED ?? 0} sub="sin consentimiento o sin medio" cls="bg-gray-50 border-dashed border-gray-300" lab="text-gray-500" val="text-gray-700" />
        <Kpi label="Fallidos" value={s?.byStatus.FAILED ?? 0} sub="el proveedor rechazó el envío" cls="bg-red-50 border-red-200" lab="text-red-700" val="text-red-900" />
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5">{chip("ALL", "Todos")}{chip("WHATSAPP", "WhatsApp")}{chip("EMAIL", "Email")}{chip("SMS", "SMS")}</div>
        <label className={SEL}><span className="text-gray-400 text-xs">Evento</span>
          <select value={event} onChange={(e) => setEvent(e.target.value)} className="bg-transparent border-0 text-sm text-gray-700 focus:outline-none">
            <option value="">Todos</option>{EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </label>
        <label className={SEL}><span className="text-gray-400 text-xs">Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-transparent border-0 text-sm text-gray-700 focus:outline-none">
            <option value="">Todos</option><option value="SENT">Enviado / Simulado</option><option value="DELIVERED">Entregado</option><option value="READ">Leído</option><option value="SKIPPED">Omitido</option><option value="FAILED">Fallido</option>
          </select>
        </label>
        <label className={SEL}><span className="text-gray-400 text-xs">Periodo</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="bg-transparent border-0 text-sm text-gray-700 focus:outline-none">
            <option value="today">Hoy</option><option value="7d">7 días</option><option value="30d">30 días</option>
          </select>
        </label>
        <label className={`${SEL} ml-auto flex-[1_1_180px] max-w-[260px]`}>
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente…" aria-label="Buscar paciente" className="bg-transparent border-0 text-sm w-full focus:outline-none" />
        </label>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200 whitespace-nowrap">Cuándo</th>
              <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Paciente</th>
              <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Canal</th>
              <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Evento</th>
              <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Origen</th>
              <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Estado</th>
              <th className="border-b border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>
            ) : !rows || rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Sin avisos en este periodo. Se generan solos al crear o reprogramar citas, pedir confirmación, invitar tras un no-show, recordar renovaciones o pedir acceso al portal.</td></tr>
            ) : rows.map((d) => {
              const name = `${d.customer.firstName ?? ""} ${d.customer.lastName ?? ""}`.trim() || "Paciente";
              const initials = `${d.customer.firstName?.[0] ?? ""}${d.customer.lastName?.[0] ?? ""}`.toUpperCase();
              return (
                <tr key={d.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">{fmtWhen(d.createdAt)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-[26px] h-[26px] rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-[10px] font-bold">{initials}</span>
                      <span className="font-medium text-gray-900">{name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><ChannelIcon channel={d.channel} size="sm" /><span className="text-gray-700">{d.channel ? CHANNEL_LABEL[d.channel] : "—"}</span></span></td>
                  <td className="px-3 py-2.5"><span className="inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 whitespace-nowrap">{d.eventLabel}</span></td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap"><span className="inline-flex items-center gap-1.5">{d.by ? <UserCircle className="w-3.5 h-3.5 text-gray-400" /> : <Bot className="w-3.5 h-3.5 text-gray-400" />}{d.by ? `Recepción · ${d.by}` : "Sistema"}</span></td>
                  <td className="px-3 py-2.5"><StatusChip d={d} /></td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap"><Link href={`/customers/${d.customer.id}?tab=comunicaciones`} className="text-xs font-semibold text-blue-600 hover:underline">Ver →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, cls, lab, val }: { label: string; value: number; sub: string; cls: string; lab: string; val: string }) {
  return (
    <div className={`border rounded-xl px-3.5 py-3 flex flex-col gap-0.5 ${cls}`}>
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${lab}`}>{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${val}`}>{value}</span>
      <span className="text-[11px] text-gray-400">{sub}</span>
    </div>
  );
}
