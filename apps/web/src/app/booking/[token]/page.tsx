"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Room {
  id: string;
  name: string;
  schedule: unknown;
}

interface Center {
  id: string;
  name: string;
  rooms: Room[];
}

interface BookingContext {
  customer: { firstName: string | null; lastName: string | null };
  product: { id: string; name: string; slotDuration: number };
  centers: Center[];
  tokenPayload: { cid: string; pid: string; tid: string };
}

// ── Fetch helpers (no auth needed) ───────────────────────────────────────────

async function linkFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

// ── Step indicators ──────────────────────────────────────────────────────────

function Steps({ current }: { current: number }) {
  const steps = ["Producto", "Centro y fecha", "Confirmar"];
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                done
                  ? "bg-green-500 text-white"
                  : active
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {done ? "✓" : n}
            </div>
            <span
              className={`text-sm ${active ? "font-medium text-gray-900" : "text-gray-400"}`}
            >
              {label}
            </span>
            {i < steps.length - 1 && <span className="text-gray-200 mx-1">›</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const params = useParams();
  const token = typeof params["token"] === "string" ? params["token"] : "";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [centerId, setCenterId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0] ?? "");
  const [slot, setSlot] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load booking context
  const {
    data: ctx,
    isLoading,
    isError,
  } = useQuery<BookingContext>({
    queryKey: ["magic-link", token],
    queryFn: () => linkFetch<BookingContext>(`/link/${token}`),
    enabled: !!token,
    retry: false,
  });

  // Load slots for selected room + date (uses public magic-link endpoint)
  const { data: slots, isFetching: loadingSlots } = useQuery<string[]>({
    queryKey: ["magic-slots", roomId, date, token],
    queryFn: () =>
      linkFetch<string[]>(
        `/link/${token}/slots?roomId=${roomId}&date=${date}`,
      ),
    enabled: !!(roomId && date && token),
  });

  const mutation = useMutation({
    mutationFn: () =>
      linkFetch<{ appointmentId: string; scheduledAt: string }>(`/link/${token}/confirm`, {
        method: "POST",
        body: JSON.stringify({ roomId, scheduledAt: slot }),
      }),
    onSuccess: (data) => {
      setConfirmedAt(data.scheduledAt);
      setConfirmed(true);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error && err.message.includes("SLOT_TAKEN")
          ? "Esta franja ya fue reservada. Por favor elige otra."
          : "Error al confirmar la reserva. Inténtalo de nuevo.";
      setError(msg);
    },
  });

  const selectedCenter = ctx?.centers.find((c) => c.id === centerId);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Cargando tu cita...</p>
      </div>
    );
  }

  if (isError || !ctx) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow p-8 text-center">
          <div className="text-4xl mb-4">⏱️</div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Enlace no válido</h1>
          <p className="text-sm text-gray-500">
            Este enlace ha expirado o ya fue utilizado. Contacta con el centro para
            obtener un nuevo enlace.
          </p>
        </div>
      </div>
    );
  }

  // ── Confirmation screen ────────────────────────────────────────────────────
  if (confirmed && confirmedAt) {
    const dt = new Date(confirmedAt);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">¡Cita confirmada!</h1>
          <p className="text-sm text-gray-500 mb-4">
            Hola {ctx.customer.firstName}, tu cita de <strong>{ctx.product.name}</strong>{" "}
            ha sido reservada para el:
          </p>
          <div className="bg-blue-50 rounded-xl p-4 text-blue-800 font-medium text-sm">
            {dt.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
            <br />
            {dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Recibirás una confirmación del centro si tienes email registrado.
          </p>
        </div>
      </div>
    );
  }

  // ── Booking flow ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow p-8">
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Reserva online</p>
          <h1 className="text-xl font-bold text-gray-900">
            Hola, {ctx.customer.firstName} {ctx.customer.lastName}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Reserva tu cita de <span className="font-medium text-gray-700">{ctx.product.name}</span>
          </p>
        </div>

        <Steps current={step} />

        {/* Step 1: Product confirmation */}
        {step === 1 && (
          <div>
            <div className="bg-blue-50 rounded-xl p-4 mb-6">
              <p className="text-xs text-blue-500 font-medium mb-1">Reconocimiento</p>
              <p className="text-base font-semibold text-blue-900">{ctx.product.name}</p>
              <p className="text-xs text-blue-600 mt-1">
                Duración aproximada: {ctx.product.slotDuration} minutos
              </p>
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
            >
              Elegir centro y fecha →
            </button>
          </div>
        )}

        {/* Step 2: Center + Room + Date + Slot */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Centro *</label>
              <select
                value={centerId}
                onChange={(e) => {
                  setCenterId(e.target.value);
                  setRoomId("");
                  setSlot("");
                }}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona un centro</option>
                {ctx.centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {centerId && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sala *</label>
                <select
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    setSlot("");
                  }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecciona sala</option>
                  {selectedCenter?.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {roomId && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fecha *</label>
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlot("");
                  }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {roomId && date && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  Horario disponible
                </label>
                {loadingSlots && (
                  <p className="text-xs text-gray-400">Cargando horarios...</p>
                )}
                {!loadingSlots && slots && slots.length === 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">
                    Sin disponibilidad para este día. Prueba otra fecha o sala.
                  </p>
                )}
                {!loadingSlots && slots && slots.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto">
                    {slots.map((s) => {
                      const time = new Date(s).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSlot(s)}
                          className={`py-2 text-xs rounded-xl border font-medium transition-colors ${
                            slot === s
                              ? "bg-blue-600 text-white border-blue-600"
                              : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                          }`}
                        >
                          {time}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm hover:bg-gray-50"
              >
                ← Atrás
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!slot}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                Revisar →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirmation summary */}
        {step === 3 && (
          <div>
            <div className="rounded-xl border border-gray-100 divide-y divide-gray-100 mb-6">
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-gray-500">Reconocimiento</span>
                <span className="font-medium text-gray-900">{ctx.product.name}</span>
              </div>
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-gray-500">Centro</span>
                <span className="font-medium text-gray-900">
                  {ctx.centers.find((c) => c.id === centerId)?.name}
                </span>
              </div>
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-gray-500">Sala</span>
                <span className="font-medium text-gray-900">
                  {selectedCenter?.rooms.find((r) => r.id === roomId)?.name}
                </span>
              </div>
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-gray-500">Fecha y hora</span>
                <span className="font-medium text-gray-900">
                  {new Date(slot).toLocaleString("es-ES", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
                {error}
                <button
                  onClick={() => { setError(null); setStep(2); }}
                  className="ml-2 underline text-red-600 text-xs"
                >
                  Cambiar horario
                </button>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm hover:bg-gray-50"
              >
                ← Cambiar
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-40"
              >
                {mutation.isPending ? "Confirmando..." : "Confirmar cita"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
