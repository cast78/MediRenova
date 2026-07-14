"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Building2, MapPin, Phone, Mail, DoorOpen, Clock, CalendarDays, MoreVertical, Plus, Search, Package, Tag } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoomSchedule {
  // Huecos explícitos por día de la semana: "0"=Dom … "6"=Sáb → ["07:00", "07:30", …]
  slotsByDay?: Record<string, string[]>;
}

interface Room {
  id: string;
  name: string;
  schedule: RoomSchedule;
  allowedProductIds: string[];
}

interface Center {
  id: string;
  name: string;
  cif: string | null;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  phones: string[];
  emails: string[];
  holidays: string[];
  active: boolean;
  rooms: Room[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resumen corto del horario para la cabecera de la sala: "30 huecos · 5 días".
function scheduleSummary(schedule: RoomSchedule): string {
  const byDay = schedule.slotsByDay ?? {};
  const days = Object.values(byDay).filter((a) => a && a.length > 0).length;
  const total = Object.values(byDay).reduce((n, a) => n + (a?.length ?? 0), 0);
  if (total === 0) return "Sin horario";
  return `${total} huecos · ${days} día${days === 1 ? "" : "s"}`;
}

// Huecos totales de una sala en la semana, y capacidad del centro (suma de sus salas).
function roomSlots(schedule: RoomSchedule): number {
  return Object.values(schedule.slotsByDay ?? {}).reduce((n, a) => n + (a?.length ?? 0), 0);
}
function centerCapacity(center: Center): number {
  return center.rooms.reduce((n, r) => n + roomSlots(r.schedule), 0);
}

// Tarjeta de métrica del panel de detalle.
function Tile({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof Clock; accent?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${accent ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-gray-100"}`}>
      <div className="flex items-center justify-between">
        <span className={`text-[11px] ${accent ? "text-blue-600" : "text-gray-400"}`}>{label}</span>
        <Icon className={`w-3.5 h-3.5 ${accent ? "text-blue-500" : "text-gray-400"}`} />
      </div>
      <p className={`text-xl font-bold mt-0.5 ${accent ? "text-blue-700" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}

// Extrae un mensaje legible de un ApiError (errores de campo Zod o array de códigos)
function errorMessage(err: unknown, fallback = "Error al guardar"): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (e && typeof e === "object" && !Array.isArray(e)) {
      const msgs = Object.values(e as Record<string, string[]>).flat().filter(Boolean);
      if (msgs.length) return msgs.join(" · ");
    }
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : fallback;
}

// ── Center Modal ──────────────────────────────────────────────────────────────

interface CenterFormData {
  name: string; cif: string; address: string; city: string; province: string; postalCode: string;
  phones: string[]; emails: string[];
}
const EMPTY_CENTER: CenterFormData = { name: "", cif: "", address: "", city: "", province: "", postalCode: "", phones: [""], emails: [""] };

// Garantiza al menos una fila vacía para poder escribir
function withRow(list: string[]): string[] {
  return list.length > 0 ? list : [""];
}

function CenterModal({ center, onClose }: { center?: Center; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CenterFormData>(
    center
      ? { name: center.name, cif: center.cif ?? "", address: center.address, city: center.city, province: center.province,
          postalCode: center.postalCode, phones: withRow(center.phones ?? []), emails: withRow(center.emails ?? []) }
      : EMPTY_CENTER
  );
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!center;

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name, address: form.address, city: form.city, province: form.province, postalCode: form.postalCode,
        phones: form.phones.map((p) => p.trim()).filter(Boolean),
        emails: form.emails.map((e) => e.trim()).filter(Boolean),
      };
      if (form.cif.trim()) body["cif"] = form.cif.trim();
      return isEdit
        ? apiFetch(`/centers/${center!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch("/centers", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  type TextKey = "name" | "cif" | "address" | "city" | "province" | "postalCode";
  function field(label: string, key: TextKey, required = false, type = "text", placeholder = "") {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && " *"}</label>
        <input type={type} required={required} value={form[key]} placeholder={placeholder}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    );
  }

  // Editor de lista (teléfonos / emails): filas con input + botón quitar, y un "+ Añadir"
  function listField(label: string, key: "phones" | "emails", type: string, placeholder: string) {
    const rows = form[key];
    const setRow = (i: number, val: string) =>
      setForm((f) => ({ ...f, [key]: f[key].map((v, idx) => (idx === i ? val : v)) }));
    const removeRow = (i: number) =>
      setForm((f) => ({ ...f, [key]: withRow(f[key].filter((_, idx) => idx !== i)) }));
    const addRow = () => setForm((f) => ({ ...f, [key]: [...f[key], ""] }));
    return (
      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
        <div className="space-y-2">
          {rows.map((val, i) => (
            <div key={i} className="flex gap-1.5">
              <input type={type} value={val} placeholder={placeholder}
                onChange={(e) => setRow(i, e.target.value)}
                className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => removeRow(i)} aria-label={`Quitar ${label}`}
                disabled={rows.length === 1 && !val}
                className="shrink-0 w-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-red-500 disabled:opacity-40">×</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium">+ Añadir {label.toLowerCase()}</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? "Editar centro" : "Nuevo centro"}</h2>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">{field("Nombre", "name", true)}{field("CIF / NIF", "cif", false, "text", "B12345674")}</div>
          {field("Dirección", "address", true)}
          <div className="grid grid-cols-2 gap-3">{field("Ciudad", "city", true)}{field("Provincia", "province", true)}</div>
          {field("Código postal", "postalCode", true)}
          <div className="grid grid-cols-2 gap-3">
            {listField("Teléfonos", "phones", "tel", "+34 91 123 45 67")}
            {listField("Emails", "emails", "email", "centro@ejemplo.es")}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear centro"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Room Modal ────────────────────────────────────────────────────────────────

interface RoomProduct { id: string; name: string; active: boolean }

interface RoomFormData {
  name: string; slotsByDay: Record<string, string[]>; allowedProductIds: string[];
}
const EMPTY_ROOM: RoomFormData = { name: "", slotsByDay: {}, allowedProductIds: [] };

// Filas del editor en orden de semana laboral (Lun→Dom); índices 0=Dom…6=Sáb de la spec.
const SCHEDULE_ROWS: { d: number; label: string }[] = [
  { d: 1, label: "Lunes" }, { d: 2, label: "Martes" }, { d: 3, label: "Miércoles" },
  { d: 4, label: "Jueves" }, { d: 5, label: "Viernes" }, { d: 6, label: "Sábado" }, { d: 0, label: "Domingo" },
];

// Genera las horas del grid de 07:00 a 22:00 según el paso (granularidad del centro).
function buildGridTimes(step: number): string[] {
  const out: string[] = [];
  for (let m = 7 * 60; m <= 22 * 60; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

function RoomModal({ centerId, room, onClose }: { centerId: string; room?: Room; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: products } = useQuery<RoomProduct[]>({ queryKey: ["products"], queryFn: () => apiFetch<RoomProduct[]>("/products") });
  const { data: tenant } = useQuery<{ config: { bookingGranularity: number } | null }>({
    queryKey: ["tenant-me"], queryFn: () => apiFetch<{ config: { bookingGranularity: number } | null }>("/tenants/me"),
  });
  const activeProducts = (products ?? []).filter((p) => p.active);
  const step = tenant?.config?.bookingGranularity ?? 30;
  const gridTimes = buildGridTimes(step);
  const [form, setForm] = useState<RoomFormData>(
    room ? { name: room.name, slotsByDay: room.schedule.slotsByDay ?? {}, allowedProductIds: room.allowedProductIds ?? [] }
      : EMPTY_ROOM
  );
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!room;

  const totalSlots = Object.values(form.slotsByDay).reduce((n, arr) => n + arr.length, 0);

  function setDaySlots(d: number, slots: string[]) {
    setForm((f) => {
      const next = { ...f.slotsByDay };
      if (slots.length === 0) delete next[String(d)];
      else next[String(d)] = [...slots].sort();
      return { ...f, slotsByDay: next };
    });
  }
  function toggleSlot(d: number, t: string) {
    const cur = form.slotsByDay[String(d)] ?? [];
    setDaySlots(d, cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }
  function copyToAll(d: number) {
    const src = form.slotsByDay[String(d)] ?? [];
    setForm((f) => {
      const next: Record<string, string[]> = {};
      if (src.length > 0) for (const { d: day } of SCHEDULE_ROWS) next[String(day)] = [...src];
      return { ...f, slotsByDay: next };
    });
  }
  function toggleProduct(id: string) {
    setForm((f) => ({ ...f, allowedProductIds: f.allowedProductIds.includes(id) ? f.allowedProductIds.filter((x) => x !== id) : [...f.allowedProductIds, id] }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body = { name: form.name, schedule: { slotsByDay: form.slotsByDay }, allowedProductIds: form.allowedProductIds };
      return isEdit
        ? apiFetch(`/centers/${centerId}/rooms/${room!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch(`/centers/${centerId}/rooms`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><DoorOpen className="w-5 h-5 text-blue-600" /></span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">{isEdit ? "Editar sala" : "Nueva sala"}</h2>
            <p className="text-xs text-gray-500">Nombre, productos que atiende y su horario de huecos</p>
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1"><Tag className="w-3.5 h-3.5 text-gray-400" /> Nombre *</label>
            <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Sala 1, Consulta A…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1"><Package className="w-3.5 h-3.5 text-gray-400" /> Productos que atiende</label>
            <p className="text-[11px] text-gray-400 mb-1.5">Marca los reconocimientos que se hacen en esta sala. Si no marcas ninguno, atiende todos.</p>
            <div className="space-y-1.5 max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {activeProducts.length === 0 && <p className="text-xs text-gray-400 px-1">No hay productos</p>}
              {activeProducts.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={form.allowedProductIds.includes(p.id)} onChange={() => toggleProduct(p.id)} className="w-4 h-4" />
                  <span className="text-sm text-gray-800">{p.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600"><Clock className="w-3.5 h-3.5 text-gray-400" /> Horario por día</label>
              <span className="text-[11px] text-blue-700 bg-blue-50 rounded-full px-2 py-0.5 tabular-nums font-medium">{totalSlots} huecos/semana</span>
            </div>
            <p className="text-[11px] text-gray-400 mb-2">Marca los huecos disponibles de cada día. Usa <span className="text-gray-500">Copiar a todos</span> para replicar un día en el resto.</p>
            <div className="space-y-2">
              {SCHEDULE_ROWS.map(({ d, label }) => {
                const sel = form.slotsByDay[String(d)] ?? [];
                return (
                  <div key={d} className="rounded-lg border border-gray-200 p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-gray-700">{label} <span className="text-gray-400 font-normal tabular-nums">{sel.length > 0 ? `· ${sel.length}` : ""}</span></span>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setDaySlots(d, gridTimes)} className="text-[10px] text-blue-600 hover:underline">Todo</button>
                        <button type="button" onClick={() => setDaySlots(d, [])} className="text-[10px] text-gray-400 hover:underline">Nada</button>
                        <button type="button" onClick={() => copyToAll(d)} className="text-[10px] text-gray-400 hover:underline">Copiar a todos</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {gridTimes.map((t) => {
                        const on = sel.includes(t);
                        return (
                          <button key={t} type="button" onClick={() => toggleSlot(d, t)}
                            className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums transition-colors ${on ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? "Guardando..." : isEdit ? "Guardar" : "Crear sala"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ label, onConfirm, onCancel, loading }: { label: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
        <h3 className="font-semibold text-gray-900 mb-2">¿Eliminar {label}?</h3>
        <p className="text-sm text-gray-500 mb-5">Esta acción no se puede deshacer.</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
          <button onClick={onConfirm} disabled={loading} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {loading ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Holidays Modal ──────────────────────────────────────────────────────────────

function HolidaysModal({ center, onClose }: { center: Center; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [dates, setDates] = useState<string[]>(center.holidays ?? []);
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/centers/${center.id}/holidays`, { method: "PUT", body: JSON.stringify({ holidays: dates }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  function add() {
    if (newDate && !dates.includes(newDate)) setDates((d) => [...d, newDate].sort());
    setNewDate("");
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Festivos</h2>
        <p className="text-sm text-gray-500 mb-4">{center.name} · días sin disponibilidad</p>

        <div className="flex gap-2 mb-3">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="button" onClick={add} disabled={!newDate}
            className="shrink-0 px-3 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-40">Añadir</button>
        </div>

        {dates.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Sin festivos configurados</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5 mb-3">
            {dates.map((d) => (
              <div key={d} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5">
                <span className="text-sm text-gray-700 tabular-nums">{new Date(`${d}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}</span>
                <button onClick={() => setDates((arr) => arr.filter((x) => x !== d))} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {mutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Center Card ───────────────────────────────────────────────────────────────

function CenterDetail({ center }: { center: Center }) {
  const queryClient = useQueryClient();
  const [editCenter, setEditCenter] = useState(false);
  const [deleteCenter, setDeleteCenter] = useState(false);
  const [newRoom, setNewRoom] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [deleteRoom, setDeleteRoom] = useState<Room | null>(null);
  const [showHolidays, setShowHolidays] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleActive = useMutation({
    mutationFn: () => apiFetch(`/centers/${center.id}`, { method: "PATCH", body: JSON.stringify({ active: !center.active }) }),
    onSuccess: () => { setMenuOpen(false); void queryClient.invalidateQueries({ queryKey: ["centers"] }); },
  });
  const deleteCenterMutation = useMutation({
    mutationFn: () => apiFetch(`/centers/${center.id}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); setDeleteCenter(false); },
  });
  const deleteRoomMutation = useMutation({
    mutationFn: (roomId: string) => apiFetch(`/centers/${center.id}/rooms/${roomId}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); setDeleteRoom(null); },
  });

  const holidayCount = center.holidays?.length ?? 0;

  return (
    <>
      {editCenter && <CenterModal center={center} onClose={() => setEditCenter(false)} />}
      {deleteCenter && <DeleteConfirm label={`el centro "${center.name}"`} onConfirm={() => deleteCenterMutation.mutate()} onCancel={() => setDeleteCenter(false)} loading={deleteCenterMutation.isPending} />}
      {newRoom && <RoomModal centerId={center.id} onClose={() => setNewRoom(false)} />}
      {editRoom && <RoomModal centerId={center.id} room={editRoom} onClose={() => setEditRoom(null)} />}
      {deleteRoom && <DeleteConfirm label={`la sala "${deleteRoom.name}"`} onConfirm={() => deleteRoomMutation.mutate(deleteRoom.id)} onCancel={() => setDeleteRoom(null)} loading={deleteRoomMutation.isPending} />}
      {showHolidays && <HolidaysModal center={center} onClose={() => setShowHolidays(false)} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-5">
          {/* Cabecera */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900">{center.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${center.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{center.active ? "Activo" : "Inactivo"}</span>
              </div>
              {center.cif && <p className="text-xs text-gray-400 mt-1 tabular-nums">CIF {center.cif}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setEditCenter(true)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
              <div className="relative">
                <button onClick={() => setMenuOpen((v) => !v)} aria-label="Más acciones" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"><MoreVertical className="w-4 h-4" /></button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-9 z-20 w-48 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
                      <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{center.active ? "Desactivar centro" : "Activar centro"}</button>
                      <button onClick={() => { setShowHolidays(true); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Festivos{holidayCount > 0 ? ` (${holidayCount})` : ""}</button>
                      <button onClick={() => { setDeleteCenter(true); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">Eliminar centro</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Contacto */}
          <div className="mt-3 space-y-1.5">
            <p className="text-sm text-gray-600 flex items-start gap-2"><MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" /> {center.address}, {center.city} ({center.province}) · {center.postalCode}</p>
            {(center.phones?.length ?? 0) > 0 && <p className="text-sm text-gray-600 flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400 shrink-0" /> {center.phones.join(" · ")}</p>}
            {(center.emails?.length ?? 0) > 0 && <p className="text-sm text-blue-600 flex items-start gap-2"><Mail className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" /> <span className="break-all">{center.emails.join(" · ")}</span></p>}
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <Tile label="Salas" value={center.rooms.length} icon={DoorOpen} />
            <Tile label="Capacidad/sem" value={centerCapacity(center)} icon={Clock} accent />
            <Tile label="Festivos" value={holidayCount} icon={CalendarDays} />
          </div>
        </div>

        {/* Salas */}
        <div className="border-t border-gray-100">
          <div className="px-5 py-3 flex items-center justify-between bg-gray-50">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Salas</p>
            <button onClick={() => setNewRoom(true)} className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Nueva sala</button>
          </div>
          {center.rooms.length === 0 && <p className="px-5 py-6 text-sm text-gray-400 text-center">Sin salas — crea la primera</p>}
          <div className="divide-y divide-gray-50">
            {center.rooms.map((room) => (
              <div key={room.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5"><DoorOpen className="w-4 h-4 text-gray-400 shrink-0" /> {room.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      <span className="text-xs text-gray-500">{(room.allowedProductIds?.length ?? 0) === 0 ? "Todos los productos" : `${room.allowedProductIds.length} producto(s)`}</span>
                      <span className="text-xs text-gray-500">{scheduleSummary(room.schedule)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setEditRoom(room)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
                    <button onClick={() => setDeleteRoom(room)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Eliminar</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CentersPage() {
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: centers, isLoading } = useQuery<Center[]>({
    queryKey: ["centers"],
    queryFn: () => apiFetch<Center[]>("/centers"),
  });

  const all = centers ?? [];
  const q = search.trim().toLowerCase();
  const visible = all
    .filter((c) => (filter === "active" ? c.active : filter === "inactive" ? !c.active : true))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q));
  // Selección efectiva: la elegida si sigue visible, si no la primera.
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="p-6 max-w-5xl">
      {showModal && <CenterModal onClose={() => setShowModal(false)} />}

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Centros</h1>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">
          + Nuevo centro
        </button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Total centros</p>
          <p className="text-2xl font-bold text-gray-800">{all.length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Activos</p>
          <p className="text-2xl font-bold text-emerald-700">{all.filter((c) => c.active).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Total salas</p>
          <p className="text-2xl font-bold text-gray-800">{all.reduce((s, c) => s + c.rooms.length, 0)}</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Capacidad total/sem</p>
          <p className="text-2xl font-bold text-blue-700">{all.reduce((s, c) => s + centerCapacity(c), 0)}</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-400 text-sm">Cargando centros...</p>
      ) : all.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-12">Sin centros registrados</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
          {/* ── Lista (maestro) ── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-2.5 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar centro"
                  className="w-full pl-8 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="px-2.5 py-2 border-b border-gray-100 flex gap-1">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${filter === f ? "bg-gray-100 text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"}`}>
                  {f === "all" ? "Todos" : f === "active" ? "Activos" : "Inactivos"}
                </button>
              ))}
            </div>
            <div className="divide-y divide-gray-50 max-h-[65vh] overflow-y-auto">
              {visible.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">Sin resultados</p>}
              {visible.map((c) => {
                const on = selected?.id === c.id;
                return (
                  <button key={c.id} onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-l-2 transition-colors ${on ? "bg-blue-50 border-blue-600" : "border-transparent hover:bg-gray-50"}`}>
                    <Building2 className={`w-4 h-4 shrink-0 ${on ? "text-blue-600" : "text-gray-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${on ? "font-medium text-gray-900" : "text-gray-800"}`}>{c.name}</p>
                      <p className="text-[11px] text-gray-500 truncate">{c.city} · {c.rooms.length} sala{c.rooms.length !== 1 ? "s" : ""}</p>
                    </div>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${c.active ? "bg-green-500" : "bg-gray-300"}`} title={c.active ? "Activo" : "Inactivo"} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Detalle ── */}
          <div>
            {selected ? (
              <CenterDetail key={selected.id} center={selected} />
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">Selecciona un centro de la lista.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
