"use client";

// Nueva visita (walk-in) = crear la reserva sobre la marcha (source WALK_IN, hora =
// ahora) + check-in inmediato. Compartido por las vistas "En vivo" y "Utilización".
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { NewCustomerModal, type CreatedCustomer } from "@/components/new-customer-modal";

interface WProduct { id: string; name: string }
interface WRoom { id: string; name: string; allowedProductIds?: string[] }
interface WCenter { id: string; name: string; rooms: WRoom[] }
interface WCustomer { id: string; firstName: string | null; lastName: string | null }

function roomOffersProduct(allowed: string[] | undefined, productId: string): boolean {
  if (!productId) return true;
  const ids = Array.isArray(allowed) ? allowed : [];
  return ids.length === 0 || ids.includes(productId);
}
function apptErr(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Array.isArray(e.errors) ? (e.errors[0] as { message?: string; code?: string }) : undefined;
    return first?.message ?? first?.code ?? `Error ${e.status}`;
  }
  return "Error inesperado";
}
// "Ahora" en hora de pared local, con el convenio naïve del sistema (UTC-etiquetado).
function nowNaive(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.000Z`;
}

export function WalkInModal({ centerId, onClose, onDone }: { centerId: string; onClose: () => void; onDone: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [chosen, setChosen] = useState<CreatedCustomer | null>(null);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: customers } = useQuery<{ data: WCustomer[] }>({
    queryKey: ["customers-search", search],
    queryFn: () => apiFetch(`/customers?q=${encodeURIComponent(search)}&limit=10`, { raw: true }),
    enabled: search.length >= 2 && !customerId,
  });
  const { data: products } = useQuery<WProduct[]>({ queryKey: ["products"], queryFn: () => apiFetch<WProduct[]>("/products") });
  const { data: centers } = useQuery<WCenter[]>({ queryKey: ["centers"], queryFn: () => apiFetch<WCenter[]>("/centers") });

  const center = centers?.find((c) => c.id === centerId);
  const rooms = (center?.rooms ?? []).filter((r) => roomOffersProduct(r.allowedProductIds, productId));
  const chosenName = chosen ? `${chosen.firstName ?? ""} ${chosen.lastName ?? ""}`.trim() : "";

  const submit = useMutation({
    mutationFn: async () => {
      const appt = await apiFetch<{ id: string }>("/appointments", {
        method: "POST",
        body: JSON.stringify({ customerId, productId, roomId, scheduledAt: nowNaive(), source: "WALK_IN" }),
      });
      await apiFetch("/visits", { method: "POST", body: JSON.stringify({ appointmentId: appt.id }) });
      return appt;
    },
    onSuccess: () => onDone(),
    onError: (e) => setError(apptErr(e)),
  });

  const canSubmit = !!customerId && !!productId && !!roomId && !submit.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      {showNewCustomer && (
        <NewCustomerModal
          onClose={() => setShowNewCustomer(false)}
          onCreated={(c) => { setChosen(c); setCustomerId(c.id); setSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()); }}
        />
      )}
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Nueva visita (walk-in)</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {/* Cliente */}
        <label className="block text-xs font-medium text-gray-500 mb-1">Cliente</label>
        {customerId ? (
          <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 mb-3">
            <span className="text-sm text-gray-800">{chosenName || "Cliente seleccionado"}</span>
            <button onClick={() => { setCustomerId(""); setChosen(null); setSearch(""); }} className="text-xs text-gray-400 hover:text-gray-700">cambiar</button>
          </div>
        ) : (
          <div className="mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o DNI…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search.length >= 2 && (
              <div className="mt-1 border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {(customers?.data ?? []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setCustomerId(c.id); setChosen({ id: c.id, firstName: c.firstName, lastName: c.lastName }); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    {`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre"}
                  </button>
                ))}
                {(customers?.data ?? []).length === 0 && (
                  <button onClick={() => setShowNewCustomer(true)} className="w-full text-left px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50">
                    + Crear cliente «{search}»
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Producto */}
        <label className="block text-xs font-medium text-gray-500 mb-1">Producto</label>
        <select
          value={productId}
          onChange={(e) => { setProductId(e.target.value); setRoomId(""); }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Selecciona producto…</option>
          {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Sala */}
        <label className="block text-xs font-medium text-gray-500 mb-1">Sala</label>
        <select
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          disabled={!productId}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">Selecciona sala…</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {productId && rooms.length === 0 && <p className="text-xs text-amber-600 -mt-3 mb-3">Ninguna sala de este centro ofrece el producto.</p>}

        <button
          onClick={() => submit.mutate()}
          disabled={!canSubmit}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submit.isPending ? "Registrando…" : "Registrar llegada"}
        </button>
      </div>
    </div>
  );
}
