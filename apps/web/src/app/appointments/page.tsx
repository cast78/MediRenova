"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface Appointment {
  id: string;
  scheduledAt: string;
  status: string;
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
  PENDING: "bg-amber-50 text-amber-700",
  CONFIRMED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
  NO_SHOW: "bg-gray-100 text-gray-600",
  RESCHEDULED: "bg-blue-50 text-blue-700",
};

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

// ── Revision row with start action ──────────────────────────────────────────

function RevisionRow({ appt, onOpenRevision }: { appt: Appointment; onOpenRevision: (revId: string) => void }) {
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
        if (err instanceof ApiError && err.status === 409) {
          // Revision already exists — API returns it in data
          return err.data as { id: string };
        }
        throw err;
      });
      if (res && typeof res === "object" && "id" in res) {
        onOpenRevision((res as { id: string }).id);
      }
    } catch (err: unknown) {
      const errors = err instanceof ApiError ? err.errors : null;
      const firstErr = Array.isArray(errors) ? (errors[0] as { code?: string; message?: string }) : null;
      if (firstErr?.code === "NO_ACTIVE_FORM") {
        setRowError("Sin formulario activo para este producto");
      } else {
        setRowError("Error al abrir revisión");
      }
    } finally {
      setLoading(false);
    }
  }

  const canRevise = appt.status === "CONFIRMED" || appt.status === "PENDING";

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-medium text-gray-900">
        {appt.customer?.firstName} {appt.customer?.lastName}
      </td>
      <td className="px-4 py-3 text-gray-600">{appt.product?.name ?? "—"}</td>
      <td className="px-4 py-3 text-gray-600">
        {appt.room?.center?.name} / {appt.room?.name}
      </td>
      <td className="px-4 py-3 text-gray-600">
        {new Date(appt.scheduledAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-600"}`}>
          {STATUS_LABELS[appt.status] ?? appt.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {canRevise && (
          <div className="flex flex-col gap-1 items-start">
            <button
              onClick={handleRevision}
              disabled={loading}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "..." : "Revisión"}
            </button>
            {rowError && <span className="text-xs text-red-500">{rowError}</span>}
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];
  const [view, setView] = useState<"list" | "agenda">("list");
  const [dateFilter, setDateFilter] = useState(today ?? "");
  const [statusFilter, setStatusFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);

  // Agenda: all confirmed appointments for the selected date, ungrouped then grouped by room
  const agendaParams = new URLSearchParams({ page: "1", limit: "100" });
  if (dateFilter) agendaParams.set("date", dateFilter);

  const { data: agendaData } = useQuery<{ data: Appointment[]; meta: { page: number; total: number; pages: number } }>({
    queryKey: ["appointments-agenda", dateFilter],
    queryFn: () => apiFetch(`/appointments?${agendaParams.toString()}`, { raw: true }),
    enabled: view === "agenda",
  });

  const agendaByRoom = (agendaData?.data ?? []).reduce<Record<string, { roomName: string; centerName: string; appts: Appointment[] }>>((acc, appt) => {
    const key = appt.room?.id ?? "unknown";
    if (!acc[key]) acc[key] = { roomName: appt.room?.name ?? "—", centerName: appt.room?.center?.name ?? "—", appts: [] };
    acc[key]!.appts.push(appt);
    return acc;
  }, {});

  const queryParams = new URLSearchParams({ page: String(page), limit: "20" });
  if (dateFilter) queryParams.set("date", dateFilter);
  if (statusFilter) queryParams.set("status", statusFilter);

  const { data, isLoading } = useQuery<{
    data: Appointment[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["appointments", dateFilter, statusFilter, page],
    queryFn: () => apiFetch(`/appointments?${queryParams.toString()}`, { raw: true }),
    enabled: view === "list",
  });

  return (
    <div className="p-6">
      {showModal && <NewAppointmentModal onClose={() => setShowModal(false)} />}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-900">Reservas</h1>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setView("list")} className={`px-3 py-1.5 ${view === "list" ? "bg-blue-600 text-white" : "hover:bg-gray-50 text-gray-600"}`}>Lista</button>
            <button onClick={() => setView("agenda")} className={`px-3 py-1.5 ${view === "agenda" ? "bg-blue-600 text-white" : "hover:bg-gray-50 text-gray-600"}`}>Agenda del día</button>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          + Nueva reserva
        </button>
      </div>

      {/* Date filter shared between both views */}
      <div className="flex gap-3 mb-4">
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {view === "list" && (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        )}
        {(dateFilter || statusFilter) && (
          <button
            onClick={() => { setDateFilter(""); setStatusFilter(""); setPage(1); }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Agenda view */}
      {view === "agenda" && (
        <div className="space-y-4">
          {Object.keys(agendaByRoom).length === 0 && (
            <p className="text-center text-gray-400 text-sm py-8">Sin reservas para este día</p>
          )}
          {Object.values(agendaByRoom).map((group) => (
            <div key={group.roomName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <p className="font-medium text-sm text-gray-900">{group.centerName} — {group.roomName}</p>
              </div>
              <div className="divide-y divide-gray-50">
                {group.appts
                  .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
                  .map((appt) => (
                    <div key={appt.id} className="px-4 py-3 flex items-center gap-4">
                      <span className="text-sm font-mono text-gray-500 w-12 shrink-0">
                        {new Date(appt.scheduledAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {appt.customer?.firstName} {appt.customer?.lastName}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{appt.product?.name ?? "—"}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {STATUS_LABELS[appt.status] ?? appt.status}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {/* List view */}
      {view === "list" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Centro / Sala</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha y hora</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">Cargando...</td>
              </tr>
            )}
            {!isLoading && (!data?.data || data.data.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin reservas para este filtro</td>
              </tr>
            )}
            {data?.data?.map((appt: Appointment) => (
              <RevisionRow key={appt.id} appt={appt} onOpenRevision={(revId) => router.push(`/revisions/${revId}`)} />
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {data && data.meta.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              {data.meta.total} reservas total
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.meta.pages, p + 1))}
                disabled={page === data.meta.pages}
                className="px-3 py-1.5 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}
