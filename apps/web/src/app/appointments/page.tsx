"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { NewCustomerModal, type CreatedCustomer } from "@/components/new-customer-modal";
import { useAppContext } from "@/components/context-bar";
import { RoomSelect } from "@/components/room-select";
import { ClientInfoModal } from "@/components/client-info-modal";
import { estadoDelCiclo, type CycleState } from "@/lib/cycle-state";
import { arrivalInfo } from "@/lib/flow";
import { ArrowUpRight, Phone, MessageCircle, Mail, MapPin, FileText, Calendar, Building2, DoorOpen, UserCircle } from "lucide-react";

// Origen de la reserva (solo destacamos los no-recepción, que son la mayoría).
const ORIGIN: Record<string, string> = { WALK_IN: "mostrador", MAGIC_LINK: "online", API: "API", BACKOFFICE: "recepción" };

interface Appointment {
  id: string;
  scheduledAt: string;
  status: string;
  durationMinutes?: number;
  customer: { id: string; firstName: string | null; lastName: string | null; phone?: string | null } | null;
  product: { id: string; name: string } | null;
  room: { id: string; name: string; center: { id: string; name: string } } | null;
  source?: string;
  notes?: string | null;
  visit?: { id: string; status: string; centerId: string; arrivedAt?: string | null; startedAt?: string | null; completedAt?: string | null } | null;
  revision?: { id: string; outcome?: string } | null;
  cancelReason?: string | null;
  rescheduledTo?: { id: string; scheduledAt: string } | null;
  rescheduledFrom?: { id: string; scheduledAt: string } | null;
}

// "Otro" se omite a propósito: con motivo opcional, "Sin especificar" (null) ya
// hace de cajón de sastre y evita la redundancia. El valor OTRO sigue en el enum
// de BD por compatibilidad, pero no se ofrece.
const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: "CLIENTE", label: "El cliente canceló" },
  { value: "CENTRO", label: "El centro canceló" },
  { value: "DUPLICADA", label: "Duplicada" },
  { value: "ERROR", label: "Error de registro" },
];
const CANCEL_REASON_LABEL: Record<string, string> = Object.fromEntries(CANCEL_REASONS.map((r) => [r.value, r.label]));

// Fecha+hora corta de una cita enlazada (reprogramación): "jue 2 jul · 08:00".
const reschedDate = (iso: string) => `${new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} · ${iso.slice(11, 16)}`;

// Trazabilidad de la cita (reserva → visita → revisión).
interface TimelineEvent { at: string; kind: string; title: string; detail: string; tone: string }
const TL_DOT: Record<string, string> = { book: "bg-gray-400", arrive: "bg-yellow-400", clinic: "bg-teal-500", comm: "bg-sky-500", confirm: "bg-emerald-500", reprog: "bg-violet-500", negative: "bg-red-500" };
const fmtTraceDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

interface Customer { id: string; firstName: string | null; lastName: string | null; }
interface Product { id: string; name: string; slotDuration: number; }
interface Room { id: string; name: string; centerId: string; allowedProductIds?: string[]; schedule?: { slotsByDay?: Record<string, string[]> }; }
interface Center { id: string; name: string; rooms: Room[]; }

// Una sala ofrece un producto si su lista de permitidos está vacía (= todos) o lo
// contiene. Sin producto seleccionado, todas valen.
function roomOffersProduct(allowed: string[] | undefined, productId: string): boolean {
  if (!productId) return true;
  const ids = allowed ?? [];
  return ids.length === 0 || ids.includes(productId);
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  ATTENDED: "Atendida",
  CANCELLED: "Cancelada",
  NO_SHOW: "No presentado",
  RESCHEDULED: "Reprogramada",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ATTENDED: "bg-violet-50 text-violet-700 border-violet-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
  NO_SHOW: "bg-red-50 text-red-600 border-red-200",
  RESCHEDULED: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-amber-400",
  CONFIRMED: "bg-emerald-500",
  ATTENDED: "bg-violet-500",
  CANCELLED: "bg-gray-400",
  NO_SHOW: "bg-red-400",
  RESCHEDULED: "bg-slate-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Vista de día unificada con Visitas (Lista + Timeline vertical).
const PX_H = 72; // altura en px de una hora en el Timeline vertical
const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso: string) => iso.slice(11, 16);
const hDec = (iso: string) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
const custName = (c: { firstName: string | null; lastName: string | null } | null) =>
  c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre" : "Sin nombre";
// "Ahora" en hora de pared naíf (para saber si una cita ya pasó).
const nowNaiveIso = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00.000Z`; };

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

// "Ahora" en hora de pared local, con el convenio naïve (UTC-etiquetado) del sistema.
// Comparable como string con appt.scheduledAt (mismo formato de ancho fijo).
function naiveNowIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.000Z`;
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
      <button onClick={() => shift(-1)} aria-label="Día anterior" className="px-3 py-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors leading-none">‹</button>
      <input type="date" value={date} onChange={(e) => onChange(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      <button onClick={() => shift(1)} aria-label="Día siguiente" className="px-3 py-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors leading-none">›</button>
      {!isToday && (
        <button onClick={() => onChange(today)} className="px-2.5 py-2 text-xs font-medium rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">Hoy</button>
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

  const { user } = useAuth();
  const canCreateCustomer = ["SUPERADMIN", "ADMIN", "RECEPTIONIST"].includes(user?.role ?? "");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [chosenCustomer, setChosenCustomer] = useState<CreatedCustomer | null>(null);

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
          productId,
          roomId,
          scheduledAt: slot,
          source: "BACKOFFICE",
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      // Las vistas usan claves con prefijo ("appointments-week/month/day/list/unclosed"),
      // así que un invalidate por ["appointments"] no casa. Se invalida por predicado.
      void queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("appointments") });
      onClose();
    },
    onError: (err: unknown) => setError(apptErr(err)),
  });

  // El cliente elegido se guarda como objeto (chosenCustomer): no se re-busca por
  // nombre, porque el buscador se rellena con "Nombre Apellido" y el backend no lo
  // encuentra (busca por campo con contains).
  const selectedCustomer = (chosenCustomer?.id === customerId ? chosenCustomer : undefined) ?? customers?.data?.find((c) => c.id === customerId);
  const selectedProduct = products?.find((p) => p.id === productId);
  const selectedRoom = selectedCenter?.rooms.find((r) => r.id === roomId);

  // Guía de progreso: concatena lo elegido en los pasos anteriores. Si aún no hay
  // nada (paso 1), muestra la indicación de qué hacer en este paso.
  const priorParts: string[] = [];
  if (step >= 2 && selectedCustomer) priorParts.push(`${selectedCustomer.firstName ?? ""} ${selectedCustomer.lastName ?? ""}`.trim() || "Cliente");
  if (step >= 2 && selectedProduct) priorParts.push(selectedProduct.name);
  if (step >= 3 && selectedCenter) priorParts.push(selectedCenter.name);
  if (step >= 3 && selectedRoom) priorParts.push(selectedRoom.name);
  const progressSubtitle = priorParts.join(" · "); // vacío en el paso 1

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      {showNewCustomer && (
        <NewCustomerModal
          onClose={() => setShowNewCustomer(false)}
          onCreated={(c) => {
            setChosenCustomer(c);
            setCustomerId(c.id);
            setCustomerSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim());
          }}
        />
      )}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Cerrar"
        >
          ×
        </button>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Nueva reserva</h2>
          <div className="flex gap-1 text-xs text-gray-400 mr-6">
            {([1, 2, 3] as const).map((s) => (
              <span key={s} className={`w-6 h-6 rounded-full flex items-center justify-center font-medium ${step >= s ? "bg-blue-600 text-white" : "bg-gray-100"}`}>{s}</span>
            ))}
          </div>
        </div>
        <p className="text-xs font-medium text-blue-600 mb-5 truncate min-h-[1rem]" title={progressSubtitle}>{progressSubtitle}</p>

        {/* Step 1: Customer + Product */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-600">Buscar cliente *</label>
                {canCreateCustomer && (
                  <button
                    type="button"
                    onClick={() => setShowNewCustomer(true)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    + Nuevo cliente
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="Nombre, email o teléfono..."
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(""); setChosenCustomer(null); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {customerSearch.length >= 2 && customers && customers.data && customers.data.length === 0 && !customerId && canCreateCustomer && (
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(true)}
                  className="mt-1 w-full text-left px-3 py-2 text-sm rounded-lg border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50"
                >
                  + Crear cliente «{customerSearch}»
                </button>
              )}
              {customers && customers.data && customers.data.length > 0 && !customerId && (
                <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-50 max-h-40 overflow-y-auto">
                  {customers.data.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setChosenCustomer({ id: c.id, firstName: c.firstName, lastName: c.lastName }); setCustomerId(c.id); setCustomerSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()); }}
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
              <label className="block text-xs font-medium text-gray-600 mb-1">Producto *</label>
              <select
                value={productId}
                onChange={(e) => { setProductId(e.target.value); setRoomId(""); setSlot(""); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Selecciona producto —</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!customerId || !productId}
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
                <option value="">— Selecciona un centro —</option>
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
                <option value="">— Selecciona sala —</option>
                {selectedCenter?.rooms.filter((r) => roomOffersProduct(r.allowedProductIds, productId)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {centerId && selectedCenter && selectedCenter.rooms.filter((r) => roomOffersProduct(r.allowedProductIds, productId)).length === 0 && (
                <p className="mt-1 text-xs text-amber-600">Ninguna sala de este centro ofrece el producto seleccionado.</p>
              )}
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
                  const time = s.slice(11, 16);
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

function AppointmentCard({ appt, onManage, onAskConfirm, isPast }: {
  appt: Appointment;
  onManage?: (a: Appointment) => void;
  onAskConfirm?: (id: string) => void;
  isPast?: boolean;
}) {
  const fullName = `${appt.customer?.firstName ?? ""} ${appt.customer?.lastName ?? ""}`.trim() || "Sin nombre";
  const initials = getInitials(appt.customer?.firstName ?? null, appt.customer?.lastName ?? null);
  const color = avatarColor(fullName);
  const time = appt.scheduledAt.slice(11, 16);

  const [showNote, setShowNote] = useState(false);
  const [showClient, setShowClient] = useState(false);

  return (
    <>
    <div onClick={onManage ? () => onManage(appt) : undefined}
      className={`flex items-center gap-4 px-5 py-4 hover:bg-gray-50/80 transition-colors group ${isPast ? "opacity-60" : ""} ${onManage ? "cursor-pointer" : ""}`}>
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center text-white text-sm font-semibold shrink-0 shadow-sm`}>
        {initials}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {appt.customer?.id ? (
            <button onClick={(e) => { e.stopPropagation(); setShowClient(true); }} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 min-w-0 text-left">
              <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-sm font-semibold text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2 truncate">{fullName}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 min-w-0"><UserCircle className="w-4 h-4 text-gray-300 shrink-0" /><span className="text-sm font-semibold text-gray-900 truncate">{fullName}</span></span>
          )}
          {appt.notes && (
            <button onClick={(e) => { e.stopPropagation(); setShowNote(true); }} title="Ver nota de la reserva" className="text-amber-500 hover:text-amber-600 shrink-0">
              <FileText className="w-3.5 h-3.5" />
            </button>
          )}
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
          {appt.durationMinutes ? (
            <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 whitespace-nowrap">{appt.durationMinutes} min</span>
          ) : null}
          {appt.room && (
            <span className="truncate hidden sm:block">
              {appt.room.center.name} · {appt.room.name}
            </span>
          )}
          {appt.rescheduledTo && <span className="text-violet-600 whitespace-nowrap">→ {reschedDate(appt.rescheduledTo.scheduledAt)}</span>}
        </div>
      </div>

      {/* Action */}
      <div className="shrink-0 flex items-center gap-2">
        {onAskConfirm && appt.status === "PENDING" && !isPast && (
          <button
            onClick={(e) => { e.stopPropagation(); onAskConfirm(appt.id); }}
            title="Pedir confirmación al cliente"
            className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium inline-flex items-center gap-1"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span className="hidden sm:inline">Pedir confirmación</span>
          </button>
        )}
        {onManage && (
          <button
            onClick={(e) => { e.stopPropagation(); onManage(appt); }}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors font-medium"
          >
            Gestionar
          </button>
        )}
      </div>
    </div>
    {showNote && appt.notes && <NoteModal name={fullName} note={appt.notes} onClose={() => setShowNote(false)} />}
    {showClient && appt.customer?.id && <ClientInfoModal customerId={appt.customer.id} onClose={() => setShowClient(false)} />}
    </>
  );
}

// Popup con la nota de la reserva (compartido por Agenda y Lista).
function NoteModal({ name, note, onClose }: { name: string; note: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 text-gray-900">
            <FileText className="w-4 h-4 text-amber-500" />
            <h3 className="text-base font-semibold">Nota de la reserva</h3>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <p className="text-xs text-gray-400 mb-2">{name}</p>
        <p className="text-sm text-gray-700 whitespace-pre-wrap rounded-lg bg-amber-50 border border-amber-100 p-3">{note}</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Selector de sala reutilizable (mismo en todas las vistas de Reservas). Las salas
// se agrupan por centro; "Todas" = sin filtro.
// ¿La cita encaja con el filtro de estado activo de los KPIs? "" = todas;
// "CANCELLED" agrupa canceladas + no presentadas (igual que la tarjeta "Canceladas").
const KPI_MATCH = (status: string, f: string): boolean =>
  f === "" || (f === "CANCELLED" ? status === "CANCELLED" || status === "NO_SHOW" : status === f);

// Fila de KPIs = filtro de estado clicable, común a todas las vistas. Los números
// son del alcance completo (centro+sala), no cambian al filtrar; al pulsar una
// tarjeta, la vista muestra solo ese estado. La tarjeta activa se resalta.
function KpiRow({ appts, active, onPick }: { appts: Appointment[]; active: string; onPick: (f: string) => void }) {
  const cards = [
    { key: "", label: "Total", value: appts.length, color: "text-gray-800", ring: "ring-gray-300", bg: "bg-white border-gray-200" },
    { key: "PENDING", label: "Pendientes", value: appts.filter((a) => a.status === "PENDING").length, color: "text-amber-700", ring: "ring-amber-400", bg: "bg-amber-50 border-amber-100" },
    { key: "CONFIRMED", label: "Confirmadas", value: appts.filter((a) => a.status === "CONFIRMED").length, color: "text-emerald-700", ring: "ring-emerald-400", bg: "bg-emerald-50 border-emerald-100" },
    { key: "ATTENDED", label: "Atendidas", value: appts.filter((a) => a.status === "ATTENDED").length, color: "text-violet-700", ring: "ring-violet-400", bg: "bg-violet-50 border-violet-100" },
    { key: "CANCELLED", label: "Canceladas", value: appts.filter((a) => a.status === "CANCELLED" || a.status === "NO_SHOW").length, color: "text-red-600", ring: "ring-red-400", bg: "bg-red-50 border-red-100" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
      {cards.map((k) => {
        const on = active === k.key;
        return (
          <button key={k.label} onClick={() => onPick(on ? "" : k.key)}
            className={`text-left rounded-xl border px-4 py-3 transition-all ${k.bg} ${on ? `ring-2 ${k.ring}` : "hover:border-gray-300"}`}
            title={k.key ? `Ver solo ${k.label.toLowerCase()}` : "Ver todas"}>
            <p className="text-xs text-gray-400 font-medium mb-0.5">{k.label}{on && k.key ? " ·" : ""}<span className="text-blue-500">{on && k.key ? " filtrando" : ""}</span></p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── Vista Semana (time-grid) ────────────────────────────────────────────────
const WK_START = 7;   // fallback de inicio del grid (si no hay horario ni citas)
const WK_END = 22;    // fallback de fin
const WK_DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const WK_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Hora "de pared" leída directamente del ISO (convención naíf del sistema de huecos).
function wkMins(iso: string): number {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function wkMonday(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function wkShift(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

// Reparte las citas de un día en carriles para que las solapadas no se pisen.
function wkLanes(appts: Appointment[]): { a: Appointment; start: number; lane: number; lanes: number }[] {
  const sorted = [...appts].sort((a, b) => wkMins(a.scheduledAt) - wkMins(b.scheduledAt));
  const laneEnd: number[] = [];
  const placed = sorted.map((a) => {
    const start = wkMins(a.scheduledAt);
    const end = start + (a.durationMinutes ?? 20);
    let lane = laneEnd.findIndex((e) => e <= start);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(end); } else { laneEnd[lane] = end; }
    return { a, start, lane };
  });
  const lanes = Math.max(1, laneEnd.length);
  return placed.map((p) => ({ ...p, lanes }));
}

function WeekView({ anchor, onAnchor, onOpenAppt, centers, roomFilter, onRoomChange, centerId, statusFilter, onStatusChange }: {
  anchor: string; onAnchor: (d: string) => void; onOpenAppt: (a: Appointment) => void;
  centers: Center[]; roomFilter: string; onRoomChange: (roomId: string) => void; centerId: string;
  statusFilter: string; onStatusChange: (f: string) => void;
}) {
  const monday = wkMonday(anchor);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const from = toLocalDateString(days[0]!);
  const to = toLocalDateString(days[6]!);
  const todayStr = toLocalDateString(new Date());

  const { data, isLoading } = useQuery<{ data: Appointment[] }>({
    queryKey: ["appointments-week", from, to],
    queryFn: () => apiFetch(`/appointments?from=${from}&to=${to}&limit=500`, { raw: true }),
  });
  // Filtro por centro (global) + sala (local). Al fijar una sala no hay solapes
  // (una sala = un paciente a la vez) → cada cita ocupa el ancho completo, sin carriles.
  const appts = (data?.data ?? []).filter((a) =>
    (!centerId || a.room?.center?.id === centerId) && (!roomFilter || a.room?.id === roomFilter),
  );
  // Salas del <select>: solo las del centro elegido (si hay); si "Todos", todas.
  const roomCenters = centerId ? centers.filter((c) => c.id === centerId) : centers;
  // El filtro de estado (KPIs) acota lo que se PINTA; los KPIs y la escala usan el alcance completo.
  const shown = appts.filter((a) => KPI_MATCH(a.status, statusFilter));
  const byDay: Record<string, Appointment[]> = {};
  for (const a of shown) (byDay[a.scheduledAt.slice(0, 10)] ??= []).push(a);

  // Escala horaria DINÁMICA: se ajusta al horario que ofertan las salas relevantes
  // (schedule.slotsByDay), ampliada a las citas presentes. Evita el hueco muerto de
  // un rango fijo 7–22 y reparte mejor las reservas.
  const relevantRooms = roomCenters.flatMap((c) => c.rooms ?? []).filter((r) => !roomFilter || r.id === roomFilter);
  const offeredH = relevantRooms.flatMap((r) => Object.values(r.schedule?.slotsByDay ?? {}).flat().map((t) => Number(t.slice(0, 2))));
  const apptH = appts.flatMap((a) => {
    const startMin = Number(a.scheduledAt.slice(11, 13)) * 60 + Number(a.scheduledAt.slice(14, 16));
    return [Math.floor(startMin / 60), Math.ceil((startMin + (a.durationMinutes ?? 20)) / 60)];
  });
  const allH = [...offeredH, ...offeredH.map((h) => h + 1), ...apptH];
  const gStart = allH.length ? Math.max(0, Math.min(...allH)) : WK_START;
  const gEnd = allH.length ? Math.min(24, Math.max(gStart + 1, Math.max(...allH))) : WK_END;
  const pxMin = 1.1; // panel más alto → reservas menos apretadas

  const hours: number[] = [];
  for (let h = gStart; h <= gEnd; h++) hours.push(h);
  const gridH = (gEnd - gStart) * 60 * pxMin;
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const label = `${days[0]!.getDate()} ${WK_MONTHS[days[0]!.getMonth()]} – ${days[6]!.getDate()} ${WK_MONTHS[days[6]!.getMonth()]} ${days[6]!.getFullYear()}`;

  return (
    <div>
      {/* Week nav */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => onAnchor(wkShift(anchor, -7))} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">‹</button>
        <span className="text-sm font-medium text-gray-800 min-w-[190px] text-center">{label}</span>
        <button onClick={() => onAnchor(wkShift(anchor, 7))} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">›</button>
        <button onClick={() => onAnchor(todayStr)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Hoy</button>
        {isLoading && <span className="text-xs text-gray-400 ml-2">Cargando…</span>}
      </div>

      {/* Leyenda + filtro de sala, pegados al calendario */}
      <div className="flex items-center gap-4 mb-2 text-xs text-gray-500 flex-wrap">
        {(["CONFIRMED", "ATTENDED", "PENDING", "RESCHEDULED", "CANCELLED", "NO_SHOW"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />{STATUS_LABELS[s]}</span>
        ))}
        <div className="ml-auto"><RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={onRoomChange} /></div>
      </div>

      <KpiRow appts={appts} active={statusFilter} onPick={onStatusChange} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Day headers */}
        <div className="flex border-b border-gray-100">
          <div className="w-12 shrink-0" />
          <div className="grid grid-cols-7 flex-1">
            {days.map((d, i) => {
              const isToday = toLocalDateString(d) === todayStr;
              return (
                <div key={i} className={`text-center py-2 border-l border-gray-50 ${isToday ? "bg-blue-50" : ""}`}>
                  <div className="text-[11px] text-gray-400">{WK_DAYS[i]}</div>
                  <div className={`text-sm font-medium ${isToday ? "text-blue-600" : "text-gray-700"}`}>{d.getDate()}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Time grid */}
        <div className="flex" style={{ height: gridH }}>
          <div className="w-12 shrink-0 relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums" style={{ top: (h - gStart) * 60 * pxMin }}>{h}:00</div>
            ))}
          </div>
          <div className="flex-1 relative">
            {hours.map((h) => (
              <div key={h} className="absolute left-0 right-0 border-t border-gray-50" style={{ top: (h - gStart) * 60 * pxMin }} />
            ))}
            <div className="absolute inset-0 grid grid-cols-7">
              {days.map((d, i) => {
                const key = toLocalDateString(d);
                const isToday = key === todayStr;
                const placed = wkLanes(byDay[key] ?? []);
                return (
                  <div key={i} className="relative border-l border-gray-50 overflow-hidden min-w-0">
                    {isToday && nowMins >= gStart * 60 && nowMins <= gEnd * 60 && (
                      <div className="absolute left-0 right-0 border-t-2 border-red-400 z-10" style={{ top: (nowMins - gStart * 60) * pxMin }} />
                    )}
                    {placed.map(({ a, start, lane, lanes }) => {
                      const top = (start - gStart * 60) * pxMin;
                      const height = Math.max((a.durationMinutes ?? 20) * pxMin, 28);
                      const canceled = a.status === "CANCELLED" || a.status === "NO_SHOW";
                      return (
                        <button
                          key={a.id}
                          onClick={() => onOpenAppt(a)}
                          title={`${a.scheduledAt.slice(11, 16)} · ${a.customer?.firstName ?? ""} ${a.customer?.lastName ?? ""} · ${a.product?.name ?? ""} · ${a.room?.name ?? ""}`}
                          className={`absolute rounded-md border px-1.5 py-0.5 text-left overflow-hidden box-border ${STATUS_COLORS[a.status] ?? "bg-gray-50 border-gray-200 text-gray-700"} ${canceled ? "line-through opacity-70" : ""}`}
                          style={{ top, height, left: `${(100 / lanes) * lane}%`, width: `calc(${100 / lanes}% - 2px)` }}
                        >
                          <span className="text-[10px] font-medium tabular-nums block leading-tight">{a.scheduledAt.slice(11, 16)}</span>
                          <span className="text-[11px] leading-tight block truncate">{a.customer?.firstName} {a.customer?.lastName}</span>
                          {height > 40 && <span className="text-[10px] opacity-70 block truncate">{a.product?.name}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vista Mes (calendario) ──────────────────────────────────────────────────
const WK_MONTHS_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function MonthView({ anchor, onAnchor, onOpenDay, centerId, roomCenters, roomFilter, onRoomChange, statusFilter, onStatusChange }: { anchor: string; onAnchor: (d: string) => void; onOpenDay: (d: string) => void; centerId: string; roomCenters: Center[]; roomFilter: string; onRoomChange: (v: string) => void; statusFilter: string; onStatusChange: (f: string) => void }) {
  const base = new Date(`${anchor}T00:00:00`);
  const year = base.getFullYear();
  const month = base.getMonth();
  const startWd = (new Date(year, month, 1).getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((startWd + daysInMonth) / 7);
  const gridStart = new Date(year, month, 1 - startWd);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; });

  const from = toLocalDateString(cells[0]!);
  const to = toLocalDateString(cells[cells.length - 1]!);
  const todayStr = toLocalDateString(new Date());

  const { data, isLoading } = useQuery<{ data: Appointment[] }>({
    queryKey: ["appointments-month", from, to],
    queryFn: () => apiFetch(`/appointments?from=${from}&to=${to}&limit=500`, { raw: true }),
  });
  const monthAppts = (data?.data ?? []).filter((a) => (!centerId || a.room?.center?.id === centerId) && (!roomFilter || a.room?.id === roomFilter));
  const shownMonth = monthAppts.filter((a) => KPI_MATCH(a.status, statusFilter));
  const byDay: Record<string, Appointment[]> = {};
  for (const a of shownMonth) (byDay[a.scheduledAt.slice(0, 10)] ??= []).push(a);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => onAnchor(toLocalDateString(new Date(year, month - 1, 1)))} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">‹</button>
        <span className="text-sm font-medium text-gray-800 min-w-[150px] text-center capitalize">{WK_MONTHS_FULL[month]} {year}</span>
        <button onClick={() => onAnchor(toLocalDateString(new Date(year, month + 1, 1)))} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">›</button>
        <button onClick={() => onAnchor(todayStr)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Hoy</button>
        {isLoading && <span className="text-xs text-gray-400 ml-2">Cargando…</span>}
      </div>

      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500 flex-wrap">
        {(["CONFIRMED", "ATTENDED", "PENDING", "RESCHEDULED", "CANCELLED", "NO_SHOW"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />{STATUS_LABELS[s]}</span>
        ))}
        <div className="ml-auto"><RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={onRoomChange} /></div>
      </div>

      <KpiRow appts={monthAppts} active={statusFilter} onPick={onStatusChange} />

      {!isLoading && centerId && monthAppts.length === 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          No hay reservas en el centro seleccionado. Cambia el centro arriba a <span className="font-medium">Todos los centros</span> para verlas.
        </div>
      )}

      <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
        {WK_DAYS.map((d) => (
          <div key={d} className="bg-gray-50 py-2 text-center text-[11px] text-gray-500">{d}</div>
        ))}
        {cells.map((d, i) => {
          const key = toLocalDateString(d);
          const other = d.getMonth() !== month;
          const isToday = key === todayStr;
          const list = byDay[key] ?? [];
          const nBy = (s: string) => list.filter((a) => a.status === s).length;
          const dots = [
            ...Array(nBy("CONFIRMED")).fill(STATUS_DOT["CONFIRMED"]),
            ...Array(nBy("ATTENDED")).fill(STATUS_DOT["ATTENDED"]),
            ...Array(nBy("PENDING")).fill(STATUS_DOT["PENDING"]),
            ...Array(nBy("RESCHEDULED")).fill(STATUS_DOT["RESCHEDULED"]),
            ...Array(nBy("CANCELLED")).fill(STATUS_DOT["CANCELLED"]),
            ...Array(nBy("NO_SHOW")).fill(STATUS_DOT["NO_SHOW"]),
          ];
          const total = list.length;
          return (
            <button key={i} onClick={() => onOpenDay(key)}
              className={`bg-white min-h-[82px] p-1.5 text-left align-top hover:bg-blue-50/50 transition-colors ${other ? "opacity-40" : ""}`}>
              <div className="flex justify-end">
                <span className={`text-xs w-5 h-5 flex items-center justify-center ${isToday ? "bg-blue-600 text-white rounded-full font-medium" : "text-gray-700"}`}>{d.getDate()}</span>
              </div>
              {total > 0 && (
                <div className="mt-1.5">
                  <div className="flex flex-wrap items-center gap-1 mb-1">
                    {dots.slice(0, 4).map((c, k) => <span key={k} className={`w-2 h-2 rounded-full ${c}`} />)}
                    {total > 4 && <span className="text-[10px] text-gray-400">+{total - 4}</span>}
                  </div>
                  <div className="text-[11px] text-gray-500">{total} cita{total > 1 ? "s" : ""}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Detalle + acciones de una cita ──────────────────────────────────────────
function apptErr(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.errors) && (e.errors[0] as { message?: string })?.message) return (e.errors[0] as { message: string }).message;
  return e instanceof Error ? e.message : "Error al actualizar";
}

// Fila de la worklist "Sin cerrar": cita de un día pasado aún sin resolver.
function UnclosedRow({ appt, onManage, onChanged }: { appt: Appointment; onManage: (a: Appointment) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const name = `${appt.customer?.firstName ?? ""} ${appt.customer?.lastName ?? ""}`.trim() || "Sin nombre";
  const dateLabel = new Date(`${appt.scheduledAt.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  async function markNoShow() {
    setBusy(true);
    try { await apiFetch(`/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify({ status: "NO_SHOW" }) }); onChanged(); }
    catch { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/60">
      <div className="w-16 shrink-0">
        <p className="text-xs text-gray-400 capitalize leading-tight">{dateLabel}</p>
        <p className="font-mono font-bold text-blue-700 text-sm">{appt.scheduledAt.slice(11, 16)}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
        <p className="text-xs text-gray-500 truncate">
          {appt.product?.name ?? "—"}{appt.room ? ` · ${appt.room.name}` : ""} · <span className="text-gray-400">{STATUS_LABELS[appt.status] ?? appt.status}</span>
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <button disabled={busy} onClick={markNoShow} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 font-medium">No presentó</button>
        <button onClick={() => onManage(appt)} className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 font-medium">Gestionar</button>
      </div>
    </div>
  );
}

// ── Pedir confirmación al cliente (WhatsApp / email con el magic link) ──────────
interface ConfirmLinkData {
  url: string;
  customer: { firstName: string | null; lastName: string | null; phone: string | null; email: string | null; acceptsWhatsapp: boolean; acceptsEmail: boolean };
  product: { name: string } | null;
  scheduledAt: string;
}

// Normaliza un teléfono español para wa.me (prefijo 34 si son 9 dígitos).
function waNorm(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("34")) return d;
  if (d.length === 9) return "34" + d;
  return d;
}

// withLink=true → mensaje real (lleva el enlace, para WhatsApp/email).
// withLink=false → vista previa sin el enlace crudo (no desborda el modal).
function confirmText(data: ConfirmLinkData, withLink: boolean): string {
  const fecha = `${new Date(`${data.scheduledAt.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} a las ${data.scheduledAt.slice(11, 16)}`;
  const nombre = data.customer.firstName ?? "";
  const base = `Hola ${nombre}, tienes una cita de ${data.product?.name ?? "revisión"} el ${fecha}. Confírmala (o avísanos si no podrás ir)`;
  return withLink ? `${base} aquí: ${data.url}` : `${base} desde el enlace.`;
}

function ConfirmRequestModal({ data, onClose }: { data: ConfirmLinkData; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const c = data.customer;
  const msg = confirmText(data, true); // mensaje enviado (con enlace)
  const waUrl = c.phone ? `https://wa.me/${waNorm(c.phone)}?text=${encodeURIComponent(msg)}` : null;
  const mailUrl = c.email ? `mailto:${c.email}?subject=${encodeURIComponent("Confirma tu cita")}&body=${encodeURIComponent(msg)}` : null;

  function Channel({ label, contact, consented, href }: { label: string; contact: string | null; consented: boolean; href: string | null }) {
    const enabled = !!contact && consented;
    return (
      <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm text-gray-800">{label}</p>
          <p className="text-xs text-gray-400 truncate">{!contact ? `Sin ${label === "Email" ? "email" : "teléfono"}` : !consented ? "Sin consentimiento del cliente" : contact}</p>
        </div>
        {enabled && href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shrink-0">Abrir</a>
        ) : (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-400 shrink-0">No disponible</span>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Pedir confirmación</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500 mb-3">El cliente confirmará (o dirá que no podrá ir) desde el enlace.</p>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 mb-4 break-words">{confirmText(data, false)}</div>
        <div className="space-y-2">
          <Channel label="WhatsApp" contact={c.phone} consented={c.acceptsWhatsapp} href={waUrl} />
          <Channel label="Email" contact={c.email} consented={c.acceptsEmail} href={mailUrl} />
          <button
            onClick={() => { void navigator.clipboard?.writeText(data.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            {copied ? "Enlace copiado ✓" : "Copiar enlace"}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">Solo se habilitan los canales que el cliente ha aceptado (RGPD).</p>
      </div>
    </div>
  );
}

// Situación del ciclo (reserva+visita+revisión) de la cita — misma fuente canónica
// que Visitas/Utilización. Añade el matiz temporal de "llegada" que el ciclo puro no
// tiene ("No llegó" / "Aún no es el día"). Se oculta en terminales que ya dice el badge.
function apptSituation(appt: Appointment, isPast: boolean, isToday: boolean): CycleState | null {
  const active = appt.status === "PENDING" || appt.status === "CONFIRMED";
  if (active && !appt.visit && !appt.revision) {
    if (isPast) return estadoDelCiclo({ apptStatus: appt.status, isPast: true }); // → "No llegó"
    if (!isToday) return { key: "no_es_dia", label: "Aún no es el día", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400", solid: "" };
    return estadoDelCiclo({ apptStatus: appt.status }); // Pendiente / Confirmada
  }
  const s = estadoDelCiclo({ apptStatus: appt.status, visitStatus: appt.visit?.status ?? null, hasRevision: !!appt.revision, revisionOutcome: appt.revision?.outcome ?? null });
  // El badge de estado ya muestra cancelada/reprogramada/no presentó → sin píldora extra.
  if (s.key === "cancelada" || s.key === "reprogramada" || s.key === "no_show") return null;
  return s;
}

function AppointmentDetailModal({ appt, onClose, onChanged, onOpenById }: {
  appt: Appointment; onClose: () => void; onChanged: () => void; onOpenById: (id: string) => void;
}) {
  const router = useRouter();
  const { setCenterId: setCtxCenter } = useAppContext();
  // "trace" es el modo inicial: al abrir se muestra la trazabilidad y un botón
  // "Gestionar reserva →" que lleva a las acciones (unificado con el popup de Visitas).
  const [mode, setMode] = useState<"trace" | "actions" | "reschedule" | "rebook">("trace");
  const [rDate, setRDate] = useState(appt.scheduledAt.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmLink, setConfirmLink] = useState<ConfirmLinkData | null>(null);
  const [showClient, setShowClient] = useState(false);

  const { data: slots, isLoading: slotsLoading } = useQuery<string[]>({
    queryKey: ["reschedule-slots", appt.room?.id, rDate, appt.product?.id],
    queryFn: () => apiFetch<string[]>(`/appointments/slots?roomId=${appt.room?.id}&date=${rDate}${appt.product?.id ? `&productId=${appt.product.id}` : ""}`),
    enabled: (mode === "reschedule" || mode === "rebook") && !!appt.room?.id,
  });
  const { data: trace, isLoading: traceLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["appt-timeline", appt.id],
    queryFn: () => apiFetch<TimelineEvent[]>(`/appointments/${appt.id}/timeline`),
    enabled: mode === "trace",
  });

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged();
      onClose();
    } catch (e) { setError(apptErr(e)); setBusy(false); }
  }

  // Check-in: crea la visita (episodio físico) desde la reserva y lleva al tablero.
  async function checkIn() {
    setBusy(true); setError(null);
    try {
      const created = await apiFetch<{ id: string }>(`/visits`, { method: "POST", body: JSON.stringify({ appointmentId: appt.id }) });
      onChanged();
      onClose();
      // Abre el tablero en el centro de la visita recién creada (contexto global) y
      // la enfoca en el tablero (?focus) para no perder el hilo tras el check-in.
      if (appt.room?.center?.id) setCtxCenter(appt.room.center.id);
      router.push(created?.id ? `/visits?focus=${created.id}` : "/visits");
    } catch (e) { setError(apptErr(e)); setBusy(false); }
  }

  // Reprogramar (modelo fantasma): esta cita queda "Reprogramada" en su día y se
  // crea una nueva en el hueco elegido. Deja rastro visible en el día original.
  async function reschedule(slot: string) {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/appointments/${appt.id}/reschedule`, { method: "POST", body: JSON.stringify({ scheduledAt: slot }) });
      onChanged();
      onClose();
    } catch (e) { setError(apptErr(e)); setBusy(false); }
  }

  // Reservar nueva cita (recuperación de una cita perdida): crea una cita NUEVA en
  // un hueco futuro con el mismo cliente/producto/sala; el registro antiguo se
  // conserva (cuenta para métricas de no-show/cancelación e historial del cliente).
  async function rebook(slot: string) {
    if (!appt.customer?.id || !appt.product?.id || !appt.room?.id) { setError("Faltan datos de la cita para reservar."); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch(`/appointments`, {
        method: "POST",
        body: JSON.stringify({ customerId: appt.customer.id, productId: appt.product.id, roomId: appt.room.id, scheduledAt: slot, source: "BACKOFFICE" }),
      });
      onChanged();
      onClose();
    } catch (e) { setError(apptErr(e)); setBusy(false); }
  }

  // Genera el enlace de confirmación y abre el selector de canal (WhatsApp/email).
  async function askConfirmation() {
    setBusy(true); setError(null);
    try {
      const data = await apiFetch<ConfirmLinkData>(`/appointments/${appt.id}/confirmation-link`, { method: "POST" });
      setConfirmLink(data);
    } catch (e) { setError(apptErr(e)); } finally { setBusy(false); }
  }

  const status = appt.status;
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPast = appt.scheduledAt <= naiveNowIso(); // la hora de la cita ya pasó
  const isToday = appt.scheduledAt.slice(0, 10) === todayStr; // la cita es HOY
  const name = `${appt.customer?.firstName ?? ""} ${appt.customer?.lastName ?? ""}`.trim() || "Sin nombre";
  const dateLabel = new Date(`${appt.scheduledAt.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  const btn = "text-sm px-3 py-2 rounded-lg border transition-colors";
  // "No presentó" solo si: confirmada, SIN visita (si hizo check-in, sí vino) y ya
  // pasó su hora (comparación en hora de pared, convenio naïve del sistema).
  const canMarkNoShow = status === "CONFIRMED" && !appt.visit && appt.scheduledAt <= naiveNowIso();
  const situation = apptSituation(appt, isPast, isToday); // etiqueta de situación (llegada)

  return (
    <>
    {showClient && appt.customer?.id && <ClientInfoModal customerId={appt.customer.id} onClose={() => setShowClient(false)} />}
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      {confirmLink && <ConfirmRequestModal data={confirmLink} onClose={() => setConfirmLink(null)} />}
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {appt.customer?.id ? (
              <button onClick={() => setShowClient(true)} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 text-left min-w-0">
                <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-semibold text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2 truncate">{name}</span>
              </button>
            ) : (
              <p className="font-semibold text-gray-900 truncate">{name}</p>
            )}
            <p className="text-sm text-gray-500 truncate">{appt.product?.name ?? "—"}{appt.durationMinutes ? ` · ${appt.durationMinutes} min` : ""}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? ""}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status] ?? "bg-gray-400"}`} />{STATUS_LABELS[status] ?? status}
            </span>
            <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {situation && (
          <div className="-mt-1 mb-3">
            <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${situation.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${situation.dot}`} />{situation.label}
            </span>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3 mb-4 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />{dateLabel} · {appt.scheduledAt.slice(11, 16)}</span>
            {appt.room ? (
              <>
                <span className="inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />{appt.room.center.name}</span>
                <span className="inline-flex items-center gap-1.5"><DoorOpen className="w-3.5 h-3.5 text-gray-400 shrink-0" />{appt.room.name}</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-gray-400"><DoorOpen className="w-3.5 h-3.5 shrink-0" />Sin sala asignada</span>
            )}
          </div>
          {status === "CANCELLED" && appt.cancelReason && (
            <div className="flex items-center gap-2.5 text-gray-500">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              <span>Motivo: {CANCEL_REASON_LABEL[appt.cancelReason] ?? appt.cancelReason}</span>
            </div>
          )}
          {appt.rescheduledTo && (
            <button onClick={() => onOpenById(appt.rescheduledTo!.id)} className="flex items-center gap-2.5 text-violet-700 hover:text-violet-900 hover:underline text-left w-full">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              <span>Movida a: {reschedDate(appt.rescheduledTo.scheduledAt)} →</span>
            </button>
          )}
          {appt.rescheduledFrom && (
            <button onClick={() => onOpenById(appt.rescheduledFrom!.id)} className="flex items-center gap-2.5 text-violet-700 hover:text-violet-900 hover:underline text-left w-full">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 5 5v6" /></svg>
              <span>Reprogramada desde: {reschedDate(appt.rescheduledFrom.scheduledAt)} →</span>
            </button>
          )}
          {appt.notes && (
            <div className="flex items-start gap-2.5 text-gray-700">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 mt-0.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></svg>
              <span className="whitespace-pre-wrap">{appt.notes}</span>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {/* Modo trazabilidad (inicial): resumen del ciclo + acceso a la gestión */}
        {mode === "trace" && (
          <div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-3 mb-4">
              <p className="text-xs text-gray-400 mb-2">Trazabilidad — reserva · visita · revisión</p>
              {traceLoading ? (
                <p className="text-xs text-gray-400">Cargando…</p>
              ) : !trace || trace.length === 0 ? (
                <p className="text-xs text-gray-400">Sin eventos registrados.</p>
              ) : (
                <ol className="relative border-l border-gray-200 ml-1 space-y-2.5">
                  {trace.map((e, i) => (
                    <li key={i} className="ml-4">
                      <span className={`absolute -left-[4px] mt-1 w-2 h-2 rounded-full ${TL_DOT[e.tone] ?? "bg-gray-400"}`} />
                      <p className="text-xs font-medium text-gray-800">{e.title}</p>
                      {e.detail && <p className="text-[11px] text-gray-500">{e.detail}</p>}
                      <p className="text-[10px] text-gray-400 capitalize">{fmtTraceDate(e.at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <button onClick={() => { setMode("actions"); setError(null); }} className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 flex items-center justify-center gap-2">
              Gestionar reserva →
            </button>
          </div>
        )}

        {mode === "actions" && (
          <div className="space-y-2">
            <button onClick={() => setMode("trace")} className="text-xs text-gray-400 hover:text-gray-600 hover:underline inline-flex items-center gap-1">← Trazabilidad</button>
            {/* Camino a la revisión: SIEMPRE pasa por la visita (check-in). Si la cita
                ya tiene visita, se va al tablero; si no, se registra la llegada. */}
            {status === "ATTENDED" && appt.revision && (
              <button onClick={() => router.push(`/revisions/${appt.revision!.id}`)} className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700">Ver revisión →</button>
            )}
            {(status === "PENDING" || status === "CONFIRMED") && (
              appt.visit ? (
                <button onClick={() => { setCtxCenter(appt.visit!.centerId); router.push(`/visits?focus=${appt.visit!.id}`); }} className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 flex items-center justify-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                  Ir a la visita →
                </button>
              ) : !isPast ? (
                <div>
                  {/* La llegada solo se registra el día de la cita (no antes). */}
                  <button disabled={busy || !isToday} onClick={checkIn} title={!isToday ? `Disponible el día de la cita (${dateLabel})` : ""}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600 flex items-center justify-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
                    Registrar llegada
                  </button>
                  {!isToday && <p className="text-[11px] text-gray-400 text-center mt-1">Disponible el día de la cita ({dateLabel})</p>}
                </div>
              ) : null
            )}
            <div className="grid grid-cols-2 gap-2">
              {status === "PENDING" && <button disabled={busy} onClick={() => patch({ status: "CONFIRMED" })} className={`${btn} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}>Confirmar</button>}
              {(status === "PENDING" || status === "CONFIRMED") && !appt.visit && <button disabled={busy} onClick={() => { setRDate(appt.scheduledAt.slice(0, 10) > todayStr ? appt.scheduledAt.slice(0, 10) : todayStr); setMode("reschedule"); setError(null); }} className={`${btn} border-gray-200 text-gray-700 hover:bg-gray-50`}>Reprogramar</button>}
              {canMarkNoShow && <button disabled={busy} onClick={() => patch({ status: "NO_SHOW" })} className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>No presentó</button>}
              {status === "PENDING" && !isPast && (
                <button disabled={busy} onClick={askConfirmation} className={`${btn} border-blue-200 text-blue-700 hover:bg-blue-50 col-span-2 inline-flex items-center justify-center gap-1.5`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Pedir confirmación al cliente
                </button>
              )}
              {/* Solo tiene sentido reactivar una cancelada AÚN futura (su hueco no ha pasado). */}
              {status === "CANCELLED" && !isPast && <button disabled={busy} onClick={() => patch({ status: "CONFIRMED" })} className={`${btn} border-emerald-200 text-emerald-700 hover:bg-emerald-50 col-span-2`}>Reactivar cita</button>}
              {/* Cancelada/no-show cuya hora ya pasó → no se reactiva; se reserva una nueva a futuro.
                  Una reprogramada NO entra aquí: ya tiene su cita nueva (ver botón arriba). */}
              {(status === "CANCELLED" || status === "NO_SHOW") && isPast && <button disabled={busy} onClick={() => { setRDate(todayStr); setMode("rebook"); setError(null); }} className={`${btn} border-blue-200 text-blue-700 hover:bg-blue-50 col-span-2`}>Reservar nueva cita →</button>}
            </div>
            {/* Cancelar solo tiene sentido en citas AÚN futuras (aún no ha pasado su
                hora) y SIN visita: si el paciente ya hizo check-in, no se cancela desde
                aquí (el flujo pasa por la visita). Una cita pasada se cierra con No
                presentó o Atendida. */}
            {(status === "PENDING" || status === "CONFIRMED") && !isPast && !appt.visit && (
              confirmingCancel ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                  <p className="text-xs text-red-700 mb-2">¿Seguro que quieres cancelar esta cita?</p>
                  <label className="block text-[11px] text-red-700/80 mb-1">Motivo (opcional)</label>
                  <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    className="w-full text-xs border border-red-200 rounded-lg px-2 py-1.5 bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-red-400">
                    <option value="">Sin especificar</option>
                    {CANCEL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => patch({ status: "CANCELLED", ...(cancelReason ? { cancelReason } : {}) })} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Sí, cancelar</button>
                    <button onClick={() => setConfirmingCancel(false)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">No</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmingCancel(true)} className={`${btn} w-full border-red-200 text-red-600 hover:bg-red-50`}>Cancelar cita</button>
              )
            )}
          </div>
        )}

        {(mode === "reschedule" || mode === "rebook") && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              {mode === "rebook" ? "Reservar nueva cita · elige fecha y hueco" : "Reprogramar · elige nueva fecha y hueco"}
            </p>
            <input type="date" value={rDate} min={todayStr} onChange={(e) => setRDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {slotsLoading && <p className="text-sm text-gray-400">Cargando huecos…</p>}
            {slots && slots.length === 0 && <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">Sin huecos disponibles ese día.</p>}
            <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto">
              {slots?.map((s) => (
                <button key={s} disabled={busy} onClick={() => (mode === "rebook" ? rebook(s) : reschedule(s))}
                  className="text-xs py-1.5 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700 disabled:opacity-50 tabular-nums">{s.slice(11, 16)}</button>
              ))}
            </div>
            <button onClick={() => setMode("actions")} className="mt-3 text-xs text-gray-400 hover:text-gray-600 hover:underline">← Volver a acciones</button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">Cargando…</div>}>
      <AppointmentsBoard />
    </Suspense>
  );
}

function AppointmentsBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { centerId } = useAppContext(); // filtro de centro global (barra superior)
  const today = toLocalDateString(new Date());

  // Estado inicial leído de la URL para poder volver justo donde estabas al
  // regresar de una revisión (y para poder compartir/enlazar la vista).
  const qView = searchParams.get("view");
  const qDay = searchParams.get("dv");
  const [view, setView] = useState<"month" | "week" | "day" | "list" | "sincerrar">(
    (["month", "week", "day", "list", "sincerrar"] as const).includes(qView as never) ? (qView as "month" | "week" | "day" | "list" | "sincerrar") : "month",
  );
  const [dayView, setDayView] = useState<"agenda" | "timeline">(
    (["agenda", "timeline"] as const).includes(qDay as never) ? (qDay as "agenda" | "timeline") : "agenda",
  );
  const [dateFilter, setDateFilter] = useState(searchParams.get("date") ?? today);
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState(searchParams.get("room") ?? ""); // filtro de sala (todas las vistas de Reservas)
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  const invalidateAppts = () => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("appointments") });
  // Abre el modal de detalle de OTRA cita por id (p.ej. saltar de un fantasma
  // reprogramado a su cita nueva sin salir del modal).
  const openApptById = async (id: string) => {
    try { setDetailAppt(await apiFetch<Appointment>(`/appointments/${id}`)); } catch { /* noop */ }
  };

  // Deep-link ?appt=<id> (p.ej. "Ver reserva" desde el popup de Utilización): abre
  // el modal de esa cita una sola vez y limpia el parámetro de la URL.
  const apptLinkOpened = useRef(false);
  useEffect(() => {
    const id = searchParams.get("appt");
    if (!id || apptLinkOpened.current) return;
    apptLinkOpened.current = true;
    void openApptById(id);
    const p = new URLSearchParams(searchParams.toString());
    p.delete("appt");
    router.replace(`/appointments${p.toString() ? `?${p.toString()}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Gestión rápida: pedir confirmación de una cita SIN abrir el modal de detalle.
  // Genera el enlace y abre directamente el selector de canal (WhatsApp/email).
  const [confirmData, setConfirmData] = useState<ConfirmLinkData | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const askConfirm = async (id: string) => {
    setConfirmErr(null);
    try { setConfirmData(await apiFetch<ConfirmLinkData>(`/appointments/${id}/confirmation-link`, { method: "POST" })); }
    catch (e) { setConfirmErr(apptErr(e)); }
  };

  // Centros (con sus salas) para el filtro de sala, disponible en todas las vistas.
  const { data: centersData } = useQuery<Center[]>({
    queryKey: ["centers"],
    queryFn: () => apiFetch<Center[]>("/centers"),
    staleTime: 5 * 60_000,
  });
  // Salas del selector: solo las del centro elegido (si hay); si "Todos", todas.
  const roomCenters = centerId ? (centersData ?? []).filter((c) => c.id === centerId) : (centersData ?? []);

  // Refleja la vista/fecha/sala en la URL (sin ensuciar el historial).
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("view", view);
    if (view === "day") p.set("dv", dayView);
    if (roomFilter) p.set("room", roomFilter);
    p.set("date", dateFilter);
    router.replace(`/appointments?${p.toString()}`, { scroll: false });
  }, [view, dayView, dateFilter, roomFilter, router]);

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
    enabled: view === "day",
  });

  // List view: sin paginar (los filtros —fecha, centro, sala, estado— mantienen la
  // lista pequeña), así los KPIs pueden ser exactos sobre todo el conjunto.
  const listParams = new URLSearchParams({ page: "1", limit: "500" });
  if (dateFilter) listParams.set("date", dateFilter);
  const { data: listData, isLoading: listLoading } = useQuery<{
    data: Appointment[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["appointments-list", dateFilter],
    queryFn: () => apiFetch(`/appointments?${listParams.toString()}`, { raw: true }),
    enabled: view === "list",
  });

  // Worklist "sin cerrar": citas de días pasados aún en PENDING/CONFIRMED. Se
  // consulta siempre (para el contador de la pestaña) y alimenta la vista.
  const { data: unclosedData, isLoading: unclosedLoading } = useQuery<{
    data: Appointment[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["appointments-unclosed"],
    queryFn: () => apiFetch(`/appointments/unclosed?limit=50`, { raw: true }),
  });
  const unclosedCount = unclosedData?.meta.total ?? 0;

  // ── Derived data ─────────────────────────────────────────────────────────

  // Filtro combinado centro (global) + sala (Reservas), aplicado a todas las vistas.
  const byFilters = (a: Appointment) =>
    (!centerId || a.room?.center?.id === centerId) && (!roomFilter || a.room?.id === roomFilter);

  // Alcance (centro+sala) → KPIs; sobre él, el filtro de estado de los KPIs acota
  // lo que se muestra (dayShown/listShown).
  const dayAppts = (dayData?.data ?? []).filter(byFilters).sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
  const listAppts = (listData?.data ?? []).filter(byFilters);
  const dayShown = dayAppts.filter((a) => KPI_MATCH(a.status, statusFilter));
  const listShown = listAppts.filter((a) => KPI_MATCH(a.status, statusFilter));

  const now = new Date();

  function handleDateChange(d: string) {
    setDateFilter(d);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl">
      {showModal && <NewAppointmentModal onClose={() => setShowModal(false)} />}
      {detailAppt && <AppointmentDetailModal key={detailAppt.id} appt={detailAppt} onClose={() => setDetailAppt(null)} onChanged={invalidateAppts} onOpenById={openApptById} />}
      {confirmData && <ConfirmRequestModal data={confirmData} onClose={() => setConfirmData(null)} />}
      {confirmErr && <div onClick={() => setConfirmErr(null)} className="fixed top-4 right-4 z-[70] bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow cursor-pointer">{confirmErr}</div>}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">Reservas</h1>
          {/* View tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white shadow-sm">
            {(["month", "week", "day", "list", "sincerrar"] as const).map((v) => {
              const labels = { month: "Mes", week: "Semana", day: "Día", list: "Agenda", sincerrar: "Sin cerrar" };
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3.5 py-1.5 font-medium transition-colors inline-flex items-center gap-1.5 ${
                    view === v
                      ? "bg-blue-600 text-white"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                >
                  {labels[v]}
                  {v === "sincerrar" && unclosedCount > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${view === v ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>{unclosedCount}</span>
                  )}
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

      {/* Date nav + filters row (la vista Semana lleva su propia navegación) */}
      <div className={`flex items-center gap-3 flex-wrap ${view === "week" || view === "month" ? "" : "mb-5"}`}>
        {view !== "week" && view !== "month" && view !== "sincerrar" && <DateNav date={dateFilter} onChange={handleDateChange} />}
        {view === "list" && (
          <div className="ml-auto flex items-center gap-3">
            {(dateFilter !== today || statusFilter) && (
              <button
                onClick={() => { setDateFilter(today); setStatusFilter(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
              >
                Limpiar filtros
              </button>
            )}
            <RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={setRoomFilter} />
          </div>
        )}
      </div>

      {/* ── WEEK VIEW ──────────────────────────────────────────────────────── */}
      {view === "week" && (
        <WeekView anchor={dateFilter} onAnchor={handleDateChange} onOpenAppt={setDetailAppt} centers={centersData ?? []} roomFilter={roomFilter} onRoomChange={setRoomFilter} centerId={centerId} statusFilter={statusFilter} onStatusChange={setStatusFilter} />
      )}

      {/* ── MONTH VIEW ─────────────────────────────────────────────────────── */}
      {view === "month" && (
        <MonthView anchor={dateFilter} onAnchor={handleDateChange} onOpenDay={(d) => { handleDateChange(d); setDayView("agenda"); setView("day"); }} centerId={centerId} roomCenters={roomCenters} roomFilter={roomFilter} onRoomChange={setRoomFilter} statusFilter={statusFilter} onStatusChange={setStatusFilter} />
      )}

      {/* ── DÍA: sub-vistas (Agenda / Por sala / Timeline) + KPIs comunes ─────── */}
      {view === "day" && (
        <>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {(["agenda", "timeline"] as const).map((dv) => {
                const dl = { agenda: "Lista", timeline: "Timeline" };
                return (
                  <button key={dv} onClick={() => setDayView(dv)}
                    className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${dayView === dv ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                    {dl[dv]}
                  </button>
                );
              })}
            </div>
            <RoomSelect roomCenters={roomCenters} value={roomFilter} onChange={setRoomFilter} />
          </div>
          <KpiRow appts={dayAppts} active={statusFilter} onPick={setStatusFilter} />
        </>
      )}

      {/* ── Día · Lista (mismo grid que la Lista de Visitas) ────────────────── */}
      {view === "day" && dayView === "agenda" && (
        <div>
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

          {!dayLoading && dayShown.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-400">Sin reservas{statusFilter ? " con ese estado" : ""} para {formatDateLabel(dateFilter).toLowerCase()}</p>
            </div>
          )}

          {!dayLoading && dayShown.length > 0 && (
            <DayLista appts={dayShown} onManage={setDetailAppt} onAskConfirm={askConfirm} />
          )}
        </div>
      )}

      {/* ── LIST VIEW ──────────────────────────────────────────────────────── */}
      {view === "list" && (
        <>
          <KpiRow appts={listAppts} active={statusFilter} onPick={setStatusFilter} />
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
            {!listLoading && listShown.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-400">Sin reservas para este filtro</p>
              </div>
            )}
            {!listLoading && listShown.length > 0 && (
              <div className="divide-y divide-gray-100">
                {listShown.map((appt) => (
                  <AppointmentCard key={appt.id} appt={appt} onManage={setDetailAppt} onAskConfirm={askConfirm} isPast={new Date(appt.scheduledAt) < now} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Día · Timeline ──────────────────────────────────────────────────── */}
      {view === "day" && dayView === "timeline" && (
        <TimelineView
          appts={dayShown}
          loading={dayLoading}
          dateFilter={dateFilter}
          onManage={setDetailAppt}
        />
      )}

      {/* ── Sin cerrar: worklist de higiene ─────────────────────────────────── */}
      {view === "sincerrar" && (
        <div>
          {unclosedLoading ? (
            <p className="text-gray-400 text-sm py-8 text-center">Cargando…</p>
          ) : unclosedCount === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-500">¡Todo al día! No hay citas de días pasados sin cerrar.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-3">
                {unclosedCount} cita{unclosedCount !== 1 ? "s" : ""} de días pasados sin resolver. Ciérralas: si vino, <span className="text-gray-700">Gestionar → registra su revisión</span>; si no vino, <span className="text-gray-700">No presentó</span>; o cancélala desde Gestionar.
              </p>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {(unclosedData?.data ?? []).map((appt) => (
                  <UnclosedRow key={appt.id} appt={appt} onManage={setDetailAppt} onChanged={invalidateAppts} />
                ))}
              </div>
              {unclosedCount > 50 && <p className="text-xs text-gray-400 mt-2">Mostrando las 50 más recientes de {unclosedCount}.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Timeline View ─────────────────────────────────────────────────────────────

// ── Vista de día: Lista + Timeline vertical (unificadas con Visitas) ───────────

// Tabla de la vista Lista (grid de la Lista de Visitas, con lo propio de la reserva:
// estado de reserva + acciones Gestionar / Pedir confirmación).
function DayLista({ appts, onManage, onAskConfirm }: { appts: Appointment[]; onManage: (a: Appointment) => void; onAskConfirm?: (id: string) => void }) {
  const router = useRouter();
  const nowNaive = nowNaiveIso();
  const rows = [...appts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const [clientId, setClientId] = useState<string | null>(null);
  const [noteAppt, setNoteAppt] = useState<{ name: string; note: string } | null>(null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-400 text-xs">
          <tr>
            <th className="text-left font-medium px-4 py-2.5">Hora</th>
            <th className="text-left font-medium px-4 py-2.5">Paciente</th>
            <th className="text-left font-medium px-4 py-2.5">Estado</th>
            <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">Sala</th>
            <th className="text-center font-medium px-4 py-2.5">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((a) => {
            const arr = arrivalInfo(a);
            const isPastRow = a.scheduledAt <= nowNaive;
            return (
              <tr key={a.id} onClick={() => onManage(a)}
                className="cursor-pointer hover:bg-gray-50/60">
                <td className="px-4 py-2.5 align-top">
                  <div className="font-mono text-blue-700 tabular-nums">{hhmm(a.scheduledAt)}</div>
                  {arr && (
                    <div className={`text-[11px] mt-0.5 ${arr.delta >= 6 ? "text-red-600" : "text-gray-400"}`}>
                      llegó {arr.at}{arr.delta >= 6 ? ` · +${arr.delta}′` : arr.delta <= -6 ? ` · ${arr.delta}′` : ""}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-1.5">
                    {a.customer?.id ? (
                      <button onClick={(e) => { e.stopPropagation(); setClientId(a.customer!.id); }} title="Ver ficha del cliente" className="group/name inline-flex items-center gap-1.5 text-left">
                        <UserCircle className="w-4 h-4 text-blue-600 shrink-0" />
                        <span className="font-medium text-gray-900 group-hover/name:text-blue-700 group-hover/name:underline underline-offset-2">{custName(a.customer)}</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-gray-900"><UserCircle className="w-4 h-4 text-gray-300 shrink-0" />{custName(a.customer)}</span>
                    )}
                    {a.notes && (
                      <button onClick={(e) => { e.stopPropagation(); setNoteAppt({ name: custName(a.customer), note: a.notes! }); }} title="Ver nota de la reserva" className="text-amber-500 hover:text-amber-600 shrink-0">
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {a.product?.name ?? "—"}{a.durationMinutes ? ` · ${a.durationMinutes} min` : ""}
                    {a.source && a.source !== "BACKOFFICE" && <span> · {ORIGIN[a.source] ?? a.source}</span>}
                    {a.rescheduledTo && <span className="text-violet-600"> · → {reschedDate(a.rescheduledTo.scheduledAt)}</span>}
                    {a.rescheduledFrom && <span className="text-violet-600"> · ↩ {reschedDate(a.rescheduledFrom.scheduledAt)}</span>}
                  </div>
                  {a.customer?.phone && (
                    <div className="text-[11px] mt-1 flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                      <a href={`tel:${a.customer.phone}`} className="text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"><Phone className="w-3 h-3" />{a.customer.phone}</a>
                      <a href={`https://wa.me/${waNorm(a.customer.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="text-emerald-600 hover:text-emerald-700 inline-flex items-center"><MessageCircle className="w-3.5 h-3.5" /></a>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[a.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[a.status] ?? "bg-gray-400"}`} />{STATUS_LABELS[a.status] ?? a.status}
                    </span>
                    {(a.revision?.outcome === "APTO" || a.revision?.outcome === "NO_APTO") && (
                      <button onClick={(e) => { e.stopPropagation(); router.push(`/revisions/${a.revision!.id}`); }}
                        className={`inline-flex items-center gap-0.5 text-xs font-medium hover:underline ${a.revision.outcome === "APTO" ? "text-green-600" : "text-red-600"}`}>
                        {a.revision.outcome === "APTO" ? "Apto" : "No apto"}<ArrowUpRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top text-gray-600 hidden sm:table-cell">{a.room?.name ?? "—"}</td>
                <td className="px-4 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-2">
                    {onAskConfirm && a.status === "PENDING" && !isPastRow && (
                      <button onClick={() => onAskConfirm(a.id)} title="Pedir confirmación al cliente"
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium inline-flex items-center gap-1">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        <span className="hidden lg:inline">Pedir confirmación</span>
                      </button>
                    )}
                    <button onClick={() => onManage(a)} className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 font-medium">Gestionar</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {clientId && <ClientInfoModal customerId={clientId} onClose={() => setClientId(null)} />}
      {noteAppt && <NoteModal name={noteAppt.name} note={noteAppt.note} onClose={() => setNoteAppt(null)} />}
    </div>
  );
}


// Timeline vertical (vista de día): tiempo hacia abajo, una columna por sala.
function TimelineView({ appts, loading, dateFilter, onManage }: {
  appts: Appointment[];
  loading: boolean;
  dateFilter: string;
  onManage: (a: Appointment) => void;
}) {
  const nowNaive = nowNaiveIso();
  const isToday = dateFilter === toLocalDateString(new Date());

  const byRoom = appts.reduce<Record<string, { roomName: string; appts: Appointment[] }>>((acc, a) => {
    const key = a.room?.id ?? "unknown";
    if (!acc[key]) acc[key] = { roomName: a.room?.name ?? "—", appts: [] };
    acc[key]!.appts.push(a);
    return acc;
  }, {});
  const rooms = Object.values(byRoom);

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
  if (rooms.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
        <p className="text-sm text-gray-400">Sin reservas para {formatDateLabel(dateFilter).toLowerCase()}</p>
      </div>
    );
  }

  // Rango horario: 08–20 por defecto, ampliado a las citas del día.
  const all = rooms.flatMap((r) => r.appts);
  let H0 = 8, H1 = 20;
  if (all.length) {
    H0 = Math.min(8, Math.floor(Math.min(...all.map((a) => hDec(a.scheduledAt)))));
    H1 = Math.max(20, Math.ceil(Math.max(...all.map((a) => hDec(a.scheduledAt) + (a.durationMinutes ?? 20) / 60))));
  }
  H0 = Math.max(6, H0); H1 = Math.min(23, H1);
  const span = Math.max(1, H1 - H0);
  const hours = Array.from({ length: span + 1 }, (_, i) => H0 + i);
  const bodyH = span * PX_H;
  const nowDec = Number(nowNaive.slice(11, 13)) + Number(nowNaive.slice(14, 16)) / 60;
  const showNow = isToday && nowDec >= H0 && nowDec <= H1;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-x-auto">
      <div className="min-w-[520px]">
        <div className="flex gap-2 mb-2">
          <div className="w-12 shrink-0" />
          {rooms.map((r) => (
            <div key={r.roomName} className="flex-1 text-center min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{r.roomName}</div>
              <div className="text-[11px] text-gray-400">{r.appts.length} cita{r.appts.length !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="w-12 shrink-0 relative" style={{ height: bodyH }}>
            {hours.map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] text-gray-400 font-mono" style={{ top: (h - H0) * PX_H }}>{pad2(h)}:00</span>
            ))}
          </div>
          {rooms.map((r) => (
            <div key={r.roomName} className="flex-1 relative rounded-lg border border-gray-200 bg-gray-50/40 min-w-0" style={{ height: bodyH }}>
              {hours.slice(1).map((h) => (
                <div key={h} className="absolute left-0 right-0 border-t border-gray-200/70" style={{ top: (h - H0) * PX_H }} />
              ))}
              {showNow && (
                <div className="absolute left-0 right-0 border-t-2 border-red-500 z-20" style={{ top: (nowDec - H0) * PX_H }}>
                  <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-500" />
                </div>
              )}
              {r.appts.map((a) => {
                const cls = STATUS_COLORS[a.status] ?? "bg-gray-100 text-gray-500 border-gray-200";
                const top = (hDec(a.scheduledAt) - H0) * PX_H;
                const hgt = Math.max(20, ((a.durationMinutes ?? 20) / 60) * PX_H);
                return (
                  <button key={a.id} onClick={() => onManage(a)}
                    className={`absolute left-1 right-1 rounded-md overflow-hidden text-left flex items-center border shadow-sm hover:ring-1 hover:ring-gray-400 ${cls}`}
                    style={{ top: top + 1, height: Math.max(18, hgt - 2) }}
                    title={`${custName(a.customer)} · ${hhmm(a.scheduledAt)} · ${a.product?.name ?? "—"} · ${STATUS_LABELS[a.status] ?? a.status}`}>
                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${STATUS_DOT[a.status] ?? "bg-gray-400"}`} />
                    <div className="pl-3 pr-1.5 truncate text-[11px] leading-none flex-1 min-w-0">
                      <span className="text-gray-900 font-medium">{custName(a.customer)}</span>
                      <span className="opacity-80"> · {hhmm(a.scheduledAt)} · {a.product?.name ?? "—"}</span>
                    </div>
                    {a.durationMinutes ? <span className="shrink-0 pr-2 text-[10px] opacity-70 tabular-nums">{a.durationMinutes}′</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-gray-500">
          {(["PENDING", "CONFIRMED", "ATTENDED", "NO_SHOW", "CANCELLED", "RESCHEDULED"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${STATUS_DOT[s]}`} />{STATUS_LABELS[s]}</span>
          ))}
          {isToday && <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-[2px] bg-red-500" />Ahora</span>}
        </div>
      </div>
    </div>
  );
}
