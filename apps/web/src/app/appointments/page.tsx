"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface Appointment {
  id: string;
  scheduledAt: string;
  status: string;
  durationMinutes?: number;
  customer: { id: string; firstName: string | null; lastName: string | null } | null;
  product: { id: string; name: string } | null;
  room: { id: string; name: string; center: { id: string; name: string } } | null;
}

interface Customer { id: string; firstName: string | null; lastName: string | null; }
interface Product { id: string; name: string; slotDuration: number; }
interface Room { id: string; name: string; centerId: string; }
interface Center { id: string; name: string; rooms: Room[]; }

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No presentado",
  RESCHEDULED: "Reprogramada",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-200",
  NO_SHOW: "bg-gray-100 text-gray-500 border-gray-200",
  RESCHEDULED: "bg-blue-50 text-blue-700 border-blue-200",
};

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-amber-400",
  CONFIRMED: "bg-emerald-500",
  CANCELLED: "bg-red-400",
  NO_SHOW: "bg-gray-400",
  RESCHEDULED: "bg-blue-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(firstName: string | null, lastName: string | null): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (!f && !l) return "?";
  return `${f[0] ?? ""}${l[0] ?? ""}`.toUpperCase();
}

function avatarColor(name: string): string {
  const colors = [
    "bg-violet-500", "bg-blue-500", "bg-cyan-500", "bg-teal-500",
    "bg-indigo-500", "bg-fuchsia-500", "bg-rose-500", "bg-orange-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length] ?? "bg-gray-400";
}

function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const today = toLocalDateString(new Date());
  const tomorrow = toLocalDateString(new Date(Date.now() + 86400000));
  const yesterday = toLocalDateString(new Date(Date.now() - 86400000));
  if (dateStr === today) return "Hoy";
  if (dateStr === tomorrow) return "Mañana";
  if (dateStr === yesterday) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

// ── Date navigation ───────────────────────────────────────────────────────────

function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const today = toLocalDateString(new Date());
  const isToday = date === today;

  function shift(days: number) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    onChange(toLocalDateString(d));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => shift(-1)}
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label="Día anterior"
      >
        ‹
      </button>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg min-w-[160px] justify-center">
        <span className="text-sm font-medium text-gray-800">
          {formatDateLabel(date)}
        </span>
        {!isToday && (
          <span className="text-xs text-gray-400">
            {new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
      <button
        onClick={() => shift(1)}
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label="Día siguiente"
      >
        ›
      </button>
      {!isToday && (
        <button
          onClick={() => onChange(today)}
          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
        >
          Hoy
        </button>
      )}
    </div>
  );
}

// ── New Booking Modal ─────────────────────────────────────────────────────────

function NewAppointmentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [centerId, setCenterId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0] ?? "");
  const [slot, setSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Data fetches
  const { data: customers } = useQuery<{ data: Customer[]; meta: { total: number; pages: number; page: number } }>({
    queryKey: ["customers-search", customerSearch],
    queryFn: () => apiFetch(`/customers?q=${encodeURIComponent(customerSearch)}&limit=10`, { raw: true }),
    enabled: customerSearch.length >= 2,
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => apiFetch<Product[]>("/products"),
  });

  const { data: centers } = useQuery<Center[]>({
    queryKey: ["centers"],
    queryFn: () => apiFetch<Center[]>("/centers"),
  });

  const selectedCenter = centers?.find((c) => c.id === centerId);

  const { data: slots } = useQuery<string[]>({
    queryKey: ["slots", roomId, date, productId],
    queryFn: () =>
      apiFetch<string[]>(`/appointments/slots?roomId=${roomId}&date=${date}${productId ? `&productId=${productId}` : ""}`),
    enabled: !!(roomId && date),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/appointments", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          productId: productId || undefined,
          roomId,
          scheduledAt: slot,
          source: "BACKOFFICE",
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al crear la reserva");
    },
  });

  const selectedCustomer = customers?.data?.find((c) => c.id === customerId);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Cerrar"
        >
          ×
        </button>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Nueva reserva</h2>
          <div className="flex gap-1 text-xs text-gray-400 mr-6">
            {([1, 2, 3] as const).map((s) => (
              <span key={s} className={`w-6 h-6 rounded-full flex items-center justify-center font-medium ${step >= s ? "bg-blue-600 text-white" : "bg-gray-100"}`}>{s}</span>
            ))}
          </div>
        </div>

        {/* Step 1: Customer + Product */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Buscar cliente *</label>
              <input
                type="text"
                placeholder="Nombre, email o teléfono..."
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(""); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {customers && customers.data && customers.data.length > 0 && !customerId && (
                <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-50 max-h-40 overflow-y-auto">
                  {customers.data.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCustomerId(c.id); setCustomerSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {c.firstName} {c.lastName}
                    </button>
                  ))}
                </div>
              )}
              {customerId && selectedCustomer && (
                <p className="mt-1 text-xs text-green-600">✓ {selectedCustomer.firstName} {selectedCustomer.lastName} seleccionado</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Producto</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Sin especificar —</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!customerId}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Center + Room + Date */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Centro *</label>
              <select
                value={centerId}
                onChange={(e) => { setCenterId(e.target.value); setRoomId(""); setSlot(""); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona centro</option>
                {centers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sala *</label>
              <select
                value={roomId}
                onChange={(e) => { setRoomId(e.target.value); setSlot(""); }}
                disabled={!centerId}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="">Selecciona sala</option>
                {selectedCenter?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha *</label>
              <input
                type="date"
                value={date}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => { setDate(e.target.value); setSlot(""); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">← Atrás</button>
              <button
                onClick={() => setStep(3)}
                disabled={!roomId || !date}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Ver disponibilidad →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Slot selection + confirm */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Slots disponibles para {date}</label>
              {!slots && <p className="text-sm text-gray-400">Cargando slots...</p>}
              {slots && slots.length === 0 && (
                <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">Sin disponibilidad para este día. Prueba otra fecha.</p>
              )}
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                {slots?.map((s) => {
                  const time = new Date(s).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={`px-2 py-2 text-xs rounded-lg border font-medium transition-colors ${slot === s ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"}`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(2)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">← Atrás</button>
              <button
                onClick={() => mutation.mutate()}
                disabled={!slot || mutation.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {mutation.isPending ? "Reservando..." : "Confirmar reserva"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Appointment Card ──────────────────────────────────────────────────────────

function AppointmentCard({ appt, onOpenRevision, isPast }: {
  appt: Appointment;
  onOpenRevision: (revId: string) => void;
  isPast?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleRevision() {
    setLoading(true);
    setRowError(null);
    try {
      const res = await apiFetch<{ id: string }>("/revisions", {
        method: "POST",
        body: JSON.stringify({ appointmentId: appt.id }),
      }).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) return err.data as { id: string };
        throw err;
      });
      if (res && typeof res === "object" && "id" in res) {
        onOpenRevision((res as { id: string }).id);
      }
    } catch (err: unknown) {
      const errors = err instanceof ApiError ? err.errors : null;
      const firstErr = Array.isArray(errors) ? (errors[0] as { code?: string }) : null;
      setRowError(firstErr?.code === "NO_ACTIVE_FORM" ? "Sin formulario activo" : "Error al abrir revisión");
    } finally {
      setLoading(false);
    }
  }

  const canRevise = appt.status === "CONFIRMED" || appt.status === "PENDING";
  const fullName = `${appt.customer?.firstName ?? ""} ${appt.customer?.lastName ?? ""}`.trim() || "Sin nombre";
  const initials = getInitials(appt.customer?.firstName ?? null, appt.customer?.lastName ?? null);
  const color = avatarColor(fullName);
  const time = new Date(appt.scheduledAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`flex items-center gap-4 px-5 py-4 hover:bg-gray-50/80 transition-colors group ${isPast ? "opacity-60" : ""}`}>
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center text-white text-sm font-semibold shrink-0 shadow-sm`}>
        {initials}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-gray-900 truncate">{fullName}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[appt.status] ?? "bg-gray-400"}`} />
            {STATUS_LABELS[appt.status] ?? appt.status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="text-blue-400">◷</span>
            <span className="font-mono font-bold text-blue-700 text-sm tracking-tight">{time}</span>
          </span>
          {appt.product && (
            <span className="truncate max-w-[180px]">{appt.product.name}</span>
          )}
          {appt.room && (
            <span className="truncate hidden sm:block">
              {appt.room.center.name} · {appt.room.name}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <div className="shrink-0 flex flex-col items-end gap-1">
        {canRevise && (
          <button
            onClick={handleRevision}
            disabled={loading}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {loading ? "..." : "Revisión →"}
          </button>
        )}
        {rowError && <span className="text-xs text-red-500">{rowError}</span>}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  const router = useRouter();
  const today = toLocalDateString(new Date());
  const [view, setView] = useState<"today" | "list" | "agenda" | "timeline">("today");
  const [dateFilter, setDateFilter] = useState(today);
  const [statusFilter, setStatusFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);

  // ── Queries ──────────────────────────────────────────────────────────────

  // Today / agenda view: fetch up to 100 for the selected day
  const dayParams = new URLSearchParams({ page: "1", limit: "100" });
  dayParams.set("date", dateFilter);
  const { data: dayData, isLoading: dayLoading } = useQuery<{
    data: Appointment[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["appointments-day", dateFilter],
    queryFn: () => apiFetch(`/appointments?${dayParams.toString()}`, { raw: true }),
    enabled: view === "today" || view === "agenda" || view === "timeline",
  });

  // List view: paginated + filterable
  const listParams = new URLSearchParams({ page: String(page), limit: "20" });
  if (dateFilter) listParams.set("date", dateFilter);
  if (statusFilter) listParams.set("status", statusFilter);
  const { data: listData, isLoading: listLoading } = useQuery<{
    data: Appointment[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["appointments-list", dateFilter, statusFilter, page],
    queryFn: () => apiFetch(`/appointments?${listParams.toString()}`, { raw: true }),
    enabled: view === "list",
  });

  // ── Derived data ─────────────────────────────────────────────────────────

  const dayAppts = (dayData?.data ?? []).sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  const now = new Date();
  const pastAppts = dayAppts.filter((a) => new Date(a.scheduledAt) < now);
  const upcomingAppts = dayAppts.filter((a) => new Date(a.scheduledAt) >= now);

  const kpis = {
    total: dayAppts.length,
    pending: dayAppts.filter((a) => a.status === "PENDING").length,
    confirmed: dayAppts.filter((a) => a.status === "CONFIRMED").length,
    cancelled: dayAppts.filter((a) => a.status === "CANCELLED" || a.status === "NO_SHOW").length,
  };

  const agendaByRoom = dayAppts.reduce<Record<string, { roomName: string; centerName: string; appts: Appointment[] }>>(
    (acc, appt) => {
      const key = appt.room?.id ?? "unknown";
      if (!acc[key]) acc[key] = { roomName: appt.room?.name ?? "—", centerName: appt.room?.center?.name ?? "—", appts: [] };
      acc[key]!.appts.push(appt);
      return acc;
    }, {}
  );

  function handleDateChange(d: string) {
    setDateFilter(d);
    setPage(1);
  }

  const onOpenRevision = (revId: string) => router.push(`/revisions/${revId}`);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl">
      {showModal && <NewAppointmentModal onClose={() => setShowModal(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">Reservas</h1>
          {/* View tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white shadow-sm">
            {(["today", "agenda", "list", "timeline"] as const).map((v) => {
              const labels = { today: "Del Dia", agenda: "Por sala", list: "Lista", timeline: "Timeline" };
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3.5 py-1.5 font-medium transition-colors ${
                    view === v
                      ? "bg-blue-600 text-white"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                >
                  {labels[v]}
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium shadow-sm transition-colors"
        >
          + Nueva reserva
        </button>
      </div>

      {/* Date nav + filters row */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <DateNav date={dateFilter} onChange={handleDateChange} />
        {view === "list" && (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-600"
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        )}
        {view === "list" && (dateFilter !== today || statusFilter) && (
          <button
            onClick={() => { setDateFilter(today); setStatusFilter(""); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* ── TODAY VIEW ─────────────────────────────────────────────────────── */}
      {view === "today" && (
        <div>
          {/* KPI bar */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total", value: kpis.total, color: "text-gray-800", bg: "bg-white border-gray-200" },
              { label: "Pendientes", value: kpis.pending, color: "text-amber-700", bg: "bg-amber-50 border-amber-100" },
              { label: "Confirmadas", value: kpis.confirmed, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100" },
              { label: "Canceladas", value: kpis.cancelled, color: "text-red-600", bg: "bg-red-50 border-red-100" },
            ].map((k) => (
              <div key={k.label} className={`rounded-xl border px-4 py-3 ${k.bg}`}>
                <p className="text-xs text-gray-400 font-medium mb-0.5">{k.label}</p>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {dayLoading && (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {[1, 2, 3].map((i) => (
                <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-gray-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                    <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!dayLoading && dayAppts.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-400">Sin reservas para {formatDateLabel(dateFilter).toLowerCase()}</p>
            </div>
          )}

          {!dayLoading && dayAppts.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {upcomingAppts.length > 0 && (
                <>
                  {pastAppts.length > 0 && (
                    <div className="px-5 py-2 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Próximas</span>
                    </div>
                  )}
                  <div className="divide-y divide-gray-100">
                    {upcomingAppts.map((appt) => (
                      <AppointmentCard key={appt.id} appt={appt} onOpenRevision={onOpenRevision} />
                    ))}
                  </div>
                </>
              )}
              {pastAppts.length > 0 && (
                <>
                  <div className="px-5 py-2 bg-gray-50 border-y border-gray-100">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Anteriores</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {pastAppts.map((appt) => (
                      <AppointmentCard key={appt.id} appt={appt} onOpenRevision={onOpenRevision} isPast />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AGENDA VIEW (by room) ───────────────────────────────────────────── */}
      {view === "agenda" && (
        <div>
          {dayLoading && <p className="text-gray-400 text-sm py-8 text-center">Cargando...</p>}
          {!dayLoading && Object.keys(agendaByRoom).length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-400">Sin reservas para {formatDateLabel(dateFilter).toLowerCase()}</p>
            </div>
          )}
          <div className="space-y-4">
            {Object.values(agendaByRoom).map((group) => (
              <div key={group.roomName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <p className="font-semibold text-sm text-gray-800">{group.centerName}</p>
                  <span className="text-gray-300">·</span>
                  <p className="text-sm text-gray-500">{group.roomName}</p>
                  <span className="ml-auto text-xs text-gray-400 font-medium">{group.appts.length} cita{group.appts.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {group.appts.map((appt) => (
                    <AppointmentCard key={appt.id} appt={appt} onOpenRevision={onOpenRevision} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ──────────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {listLoading && (
            <div className="divide-y divide-gray-100">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-gray-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                    <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!listLoading && (!listData?.data || listData.data.length === 0) && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400">Sin reservas para este filtro</p>
            </div>
          )}
          {!listLoading && listData?.data && listData.data.length > 0 && (
            <div className="divide-y divide-gray-100">
              {listData.data.map((appt) => (
                <AppointmentCard key={appt.id} appt={appt} onOpenRevision={onOpenRevision} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {listData && listData.meta.pages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
              <p className="text-xs text-gray-400">
                {listData.meta.total} reservas · página {page} de {listData.meta.pages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-white transition-colors"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(listData.meta.pages, p + 1))}
                  disabled={page === listData.meta.pages}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-white transition-colors"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TIMELINE VIEW ──────────────────────────────────────────────────── */}
      {view === "timeline" && (
        <TimelineView
          appts={dayAppts}
          loading={dayLoading}
          dateFilter={dateFilter}
          onOpenRevision={onOpenRevision}
        />
      )}
    </div>
  );
}

// ── Timeline View ─────────────────────────────────────────────────────────────

const TIMELINE_START_H = 8;   // 08:00
const TIMELINE_END_H   = 20;  // 20:00
const TOTAL_MINUTES    = (TIMELINE_END_H - TIMELINE_START_H) * 60;

const STATUS_BLOCK: Record<string, string> = {
  PENDING:     "bg-amber-400 hover:bg-amber-500",
  CONFIRMED:   "bg-emerald-500 hover:bg-emerald-600",
  CANCELLED:   "bg-red-300 hover:bg-red-400 opacity-60",
  NO_SHOW:     "bg-gray-300 hover:bg-gray-400 opacity-60",
  RESCHEDULED: "bg-blue-400 hover:bg-blue-500",
};

// Tooltip rendered at fixed screen position to avoid panel clipping
function TooltipPortal({ appt, fullName }: { appt: Appointment; fullName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [above, setAbove] = useState(true);

  // Position on mount using getBoundingClientRect of the parent block
  const parentRef = useRef<HTMLDivElement>(null);

  // Use a fixed-position tooltip anchored to the parent via a wrapper
  return (
    <div
      ref={parentRef}
      className="absolute inset-0 pointer-events-none z-30"
      // overflow visible so the tooltip escapes the row container
    >
      {/* Tooltip — always rendered below the block to avoid top clipping */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-2xl whitespace-nowrap">
        <p className="font-semibold text-white">{fullName || "Sin nombre"}</p>
        <p className="text-gray-300 mt-0.5">{appt.product?.name ?? "—"}</p>
        <p className="text-gray-400 mt-0.5">
          {new Date(appt.scheduledAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          {appt.durationMinutes ? ` · ${appt.durationMinutes} min` : ""}
        </p>
        <p className={`mt-0.5 font-medium ${STATUS_DOT[appt.status] ? "" : "text-gray-400"}`} style={{ color: appt.status === "CONFIRMED" ? "#6ee7b7" : appt.status === "PENDING" ? "#fcd34d" : "#f87171" }}>
          {STATUS_LABELS[appt.status]}
        </p>
        {(appt.status === "CONFIRMED" || appt.status === "PENDING") && (
          <p className="text-blue-400 mt-1 text-[10px] font-medium">Clic para abrir revisión</p>
        )}
        {/* Arrow pointing up */}
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-900" />
      </div>
    </div>
  );
}

function TimelineView({
  appts, loading, dateFilter, onOpenRevision,
}: {
  appts: Appointment[];
  loading: boolean;
  dateFilter: string;
  onOpenRevision: (revId: string) => void;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);

  const hours = Array.from({ length: TIMELINE_END_H - TIMELINE_START_H + 1 }, (_, i) => TIMELINE_START_H + i);

  // Group by room
  const byRoom = appts.reduce<Record<string, { roomName: string; centerName: string; appts: Appointment[] }>>(
    (acc, appt) => {
      const key = appt.room?.id ?? "unknown";
      if (!acc[key]) acc[key] = { roomName: appt.room?.name ?? "—", centerName: appt.room?.center?.name ?? "—", appts: [] };
      acc[key]!.appts.push(appt);
      return acc;
    }, {}
  );

  function toPercent(scheduledAt: string): { left: number; width: number } {
    const d = new Date(scheduledAt);
    const minutesSinceStart = d.getHours() * 60 + d.getMinutes() - TIMELINE_START_H * 60;
    const left = Math.max(0, (minutesSinceStart / TOTAL_MINUTES) * 100);
    // Use durationMinutes from appointment, fallback 30
    const appt = appts.find((a) => a.scheduledAt === scheduledAt);
    const dur = appt?.durationMinutes ?? 30;
    const width = Math.max(1.5, (dur / TOTAL_MINUTES) * 100);
    return { left: Math.min(left, 100 - width), width };
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 items-center">
            <div className="w-28 h-4 bg-gray-100 rounded shrink-0" />
            <div className="flex-1 h-10 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (Object.keys(byRoom).length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
        <p className="text-sm text-gray-400">Sin reservas para {formatDateLabel(dateFilter).toLowerCase()}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Time header */}
      <div className="flex border-b border-gray-100 bg-gray-50 rounded-t-xl">
        <div className="w-32 shrink-0 px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide border-r border-gray-100">
          Sala
        </div>
        <div className="flex-1 relative h-9">
          {hours.map((h) => (
            <div
              key={h}
              className="absolute top-0 h-full flex flex-col justify-end pb-1.5"
              style={{ left: `${((h - TIMELINE_START_H) / (TIMELINE_END_H - TIMELINE_START_H)) * 100}%` }}
            >
              <span className="text-[10px] text-gray-400 font-medium -translate-x-1/2">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Room rows */}
      <div className="divide-y divide-gray-100">
        {Object.values(byRoom).map((group) => (
          <div key={group.roomName} className="flex items-stretch min-h-[52px]">
            {/* Room label */}
            <div className="w-32 shrink-0 px-4 py-3 border-r border-gray-100 bg-gray-50/50 flex flex-col justify-center">
              <p className="text-xs font-semibold text-gray-700 truncate">{group.roomName}</p>
              <p className="text-[10px] text-gray-400 truncate">{group.centerName}</p>
            </div>

            {/* Timeline track */}
            <div className="flex-1 relative py-2.5 px-1">
              {/* Hour grid lines */}
              {hours.slice(0, -1).map((h) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-gray-100"
                  style={{ left: `${((h - TIMELINE_START_H) / (TIMELINE_END_H - TIMELINE_START_H)) * 100}%` }}
                />
              ))}

              {/* Appointment blocks */}
              {group.appts.map((appt) => {
                const { left, width } = toPercent(appt.scheduledAt);
                const fullName = `${appt.customer?.firstName ?? ""} ${appt.customer?.lastName ?? ""}`.trim();
                const initials = getInitials(appt.customer?.firstName ?? null, appt.customer?.lastName ?? null);
                const blockKey = appt.id;
                return (
                  <div
                    key={appt.id}
                    className={`absolute top-1.5 bottom-1.5 rounded-md cursor-pointer transition-all shadow-sm ${STATUS_BLOCK[appt.status] ?? "bg-gray-300"}`}
                    style={{ left: `${left}%`, width: `${width}%`, minWidth: "28px" }}
                    onMouseEnter={() => setTooltip(blockKey)}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => {
                      if (appt.status === "CONFIRMED" || appt.status === "PENDING") {
                        void (async () => {
                          try {
                            const res = await apiFetch<{ id: string }>("/revisions", {
                              method: "POST",
                              body: JSON.stringify({ appointmentId: appt.id }),
                            }).catch((err: unknown) => {
                              if (err instanceof ApiError && err.status === 409) return err.data as { id: string };
                              throw err;
                            });
                            if (res && "id" in res) onOpenRevision(res.id);
                          } catch { /* noop */ }
                        })();
                      }
                    }}
                  >
                    <div className="px-1.5 py-0.5 overflow-hidden h-full flex items-center">
                      <span className="text-white text-[10px] font-bold truncate leading-none">{initials}</span>
                    </div>

                    {/* Tooltip — rendered via fixed positioning to avoid clipping */}
                    {tooltip === blockKey && (
                      <TooltipPortal appt={appt} fullName={fullName} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Current time indicator (only for today) */}
      {dateFilter === toLocalDateString(new Date()) && (() => {
        const now = new Date();
        const minNow = now.getHours() * 60 + now.getMinutes() - TIMELINE_START_H * 60;
        if (minNow < 0 || minNow > TOTAL_MINUTES) return null;
        const leftPct = (minNow / TOTAL_MINUTES) * 100;
        return (
          <div className="relative h-0">
            <div
              className="absolute top-0 -translate-y-full pointer-events-none"
              style={{ left: `calc(128px + (100% - 128px) * ${leftPct / 100})` }}
            >
              <div className="w-0.5 bg-red-400 h-[calc(100vh)] absolute" style={{ height: "100vh" }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
