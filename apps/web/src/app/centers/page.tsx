"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoomSchedule {
  openTime?: string;
  closeTime?: string;
  activeDays?: number[];
  slotDuration?: number;
  slotBuffer?: number;
}

interface Room {
  id: string;
  name: string;
  schedule: RoomSchedule;
  allowedProductTypes: string[];
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
  active: boolean;
  rooms: Room[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function dayLabels(days?: number[]) {
  if (!days || days.length === 0) return "—";
  return days.map((d) => DAYS[d]).join(", ");
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

interface RoomFormData {
  name: string; openTime: string; closeTime: string; slotDuration: string; slotBuffer: string; activeDays: number[];
}
const EMPTY_ROOM: RoomFormData = { name: "", openTime: "09:00", closeTime: "18:00", slotDuration: "30", slotBuffer: "5", activeDays: [1, 2, 3, 4, 5] };

function RoomModal({ centerId, room, onClose }: { centerId: string; room?: Room; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RoomFormData>(
    room ? { name: room.name, openTime: room.schedule.openTime ?? "09:00", closeTime: room.schedule.closeTime ?? "18:00",
        slotDuration: String(room.schedule.slotDuration ?? 30), slotBuffer: String(room.schedule.slotBuffer ?? 5), activeDays: room.schedule.activeDays ?? [1, 2, 3, 4, 5] }
      : EMPTY_ROOM
  );
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!room;

  function toggleDay(d: number) {
    setForm((f) => ({ ...f, activeDays: f.activeDays.includes(d) ? f.activeDays.filter((x) => x !== d) : [...f.activeDays, d].sort() }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body = { name: form.name, schedule: { openTime: form.openTime, closeTime: form.closeTime, slotDuration: parseInt(form.slotDuration), slotBuffer: parseInt(form.slotBuffer), activeDays: form.activeDays } };
      return isEdit
        ? apiFetch(`/centers/${centerId}/rooms/${room!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch(`/centers/${centerId}/rooms`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? "Editar sala" : "Nueva sala"}</h2>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
            <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Apertura</label>
              <input type="time" value={form.openTime} onChange={(e) => setForm((f) => ({ ...f, openTime: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cierre</label>
              <input type="time" value={form.closeTime} onChange={(e) => setForm((f) => ({ ...f, closeTime: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Duración cita (min)</label>
              <input type="number" min={5} max={120} step={5} value={form.slotDuration}
                onChange={(e) => setForm((f) => ({ ...f, slotDuration: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Margen entre citas (min)</label>
              <input type="number" min={0} max={60} step={5} value={form.slotBuffer}
                onChange={(e) => setForm((f) => ({ ...f, slotBuffer: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Días activos</label>
            <div className="flex gap-1.5">
              {DAYS.map((label, d) => (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${form.activeDays.includes(d) ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {label}
                </button>
              ))}
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

// ── Weekly schedule calendar (visual) ──────────────────────────────────────────

// Lunes → Domingo (los índices siguen la convención 0=Dom … 6=Sáb de la spec)
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const PX_PER_MIN = 0.5;

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

// Una franja horaria normalizada: día (0=Dom…6=Sáb), inicio y fin.
interface ScheduleSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

// El `schedule` de una sala llega en dos formatos posibles:
//   • array de franjas  [{ dayOfWeek, startTime, endTime }]  (formato del seed / multi-franja)
//   • objeto único      { openTime, closeTime, activeDays, slotDuration, slotBuffer }  (formato del RoomModal)
// Normalizamos ambos a una lista de franjas + el paso de slot (solo conocido en el formato objeto).
function normalizeSchedule(schedule: RoomSchedule | ScheduleSlot[]): { slots: ScheduleSlot[]; step: number } {
  if (Array.isArray(schedule)) {
    const slots = schedule.filter((s) => s && s.startTime && s.endTime);
    return { slots, step: 0 };
  }
  const { openTime, closeTime, activeDays, slotDuration, slotBuffer } = schedule;
  if (!openTime || !closeTime) return { slots: [], step: 0 };
  const slots = (activeDays ?? []).map((d) => ({ dayOfWeek: d, startTime: openTime, endTime: closeTime }));
  return { slots, step: (slotDuration ?? 0) + (slotBuffer ?? 0) };
}

function RoomScheduleCalendar({ schedule }: { schedule: RoomSchedule | ScheduleSlot[] }) {
  const { slots, step } = normalizeSchedule(schedule);

  if (slots.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
        <p className="text-xs text-gray-400">Sin horario configurado — edita la sala para añadirlo</p>
      </div>
    );
  }

  const activeDays = new Set(slots.map((s) => s.dayOfWeek));
  const minStart = Math.min(...slots.map((s) => toMinutes(s.startTime)));
  const maxEnd = Math.max(...slots.map((s) => toMinutes(s.endTime)));
  const startHour = Math.floor(minStart / 60);
  const endHour = Math.ceil(maxEnd / 60);
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  const gridHeight = (endHour - startHour) * 60 * PX_PER_MIN;

  // Etiqueta de citas/día (solo cuando conocemos la duración del slot — formato objeto)
  const firstSlot = slots[0];
  const nSlots =
    step > 0 && firstSlot ? Math.floor((toMinutes(firstSlot.endTime) - toMinutes(firstSlot.startTime)) / step) : 0;

  function block(slot: ScheduleSlot, key: number) {
    const top = (toMinutes(slot.startTime) - startHour * 60) * PX_PER_MIN;
    const height = (toMinutes(slot.endTime) - toMinutes(slot.startTime)) * PX_PER_MIN;
    const dividers: number[] = [];
    for (let i = 1; i < nSlots; i++) dividers.push(i * step * PX_PER_MIN);
    return (
      <div key={key} className="absolute left-0 right-0 rounded-md bg-blue-500/15 border border-blue-500/30"
        style={{ top, height }} title={`${slot.startTime} – ${slot.endTime}`}>
        {dividers.map((off, i) => (
          <div key={i} className="absolute left-0 right-0 border-t border-dashed border-blue-400/30" style={{ top: off }} />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Horario semanal</span>
        {nSlots > 0 && <span className="text-[11px] text-gray-400 tabular-nums">≈ {nSlots} citas/día</span>}
      </div>

      <div className="px-3 py-3">
        {/* Day labels header */}
        <div className="flex mb-1.5">
          <div className="w-10 shrink-0" />
          <div className="grid grid-cols-7 gap-1 flex-1">
            {WEEK_ORDER.map((d) => (
              <div key={d} className={`text-center text-[10px] font-semibold ${activeDays.has(d) ? "text-gray-600" : "text-gray-300"}`}>
                {DAYS[d]}
              </div>
            ))}
          </div>
        </div>

        {/* Timed grid */}
        <div className="flex">
          {/* Hour gutter */}
          <div className="relative w-10 shrink-0" style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums"
                style={{ top: (h - startHour) * 60 * PX_PER_MIN }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="relative flex-1">
            {/* Hour gridlines */}
            {hours.map((h) => (
              <div key={h} className="absolute left-0 right-0 border-t border-gray-100"
                style={{ top: (h - startHour) * 60 * PX_PER_MIN }} />
            ))}
            <div className="relative grid grid-cols-7 gap-1" style={{ height: gridHeight }}>
              {WEEK_ORDER.map((d) => {
                const daySlots = slots.filter((s) => s.dayOfWeek === d);
                return (
                  <div key={d} className={`relative rounded-md ${daySlots.length === 0 ? "bg-gray-50/60" : ""}`}>
                    {daySlots.map((s, i) => block(s, i))}
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

// ── Center Card ───────────────────────────────────────────────────────────────

function CenterCard({ center }: { center: Center }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editCenter, setEditCenter] = useState(false);
  const [deleteCenter, setDeleteCenter] = useState(false);
  const [newRoom, setNewRoom] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [deleteRoom, setDeleteRoom] = useState<Room | null>(null);

  const toggleActive = useMutation({
    mutationFn: () => apiFetch(`/centers/${center.id}`, { method: "PATCH", body: JSON.stringify({ active: !center.active }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["centers"] }),
  });

  const deleteCenterMutation = useMutation({
    mutationFn: () => apiFetch(`/centers/${center.id}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); setDeleteCenter(false); },
  });

  const deleteRoomMutation = useMutation({
    mutationFn: (roomId: string) => apiFetch(`/centers/${center.id}/rooms/${roomId}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); setDeleteRoom(null); },
  });

  return (
    <>
      {editCenter && <CenterModal center={center} onClose={() => setEditCenter(false)} />}
      {deleteCenter && <DeleteConfirm label={`el centro "${center.name}"`} onConfirm={() => deleteCenterMutation.mutate()} onCancel={() => setDeleteCenter(false)} loading={deleteCenterMutation.isPending} />}
      {newRoom && <RoomModal centerId={center.id} onClose={() => setNewRoom(false)} />}
      {editRoom && <RoomModal centerId={center.id} room={editRoom} onClose={() => setEditRoom(null)} />}
      {deleteRoom && <DeleteConfirm label={`la sala "${deleteRoom.name}"`} onConfirm={() => deleteRoomMutation.mutate(deleteRoom.id)} onCancel={() => setDeleteRoom(null)} loading={deleteRoomMutation.isPending} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <h2 className="font-semibold text-gray-900 truncate">{center.name}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${center.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {center.active ? "Activo" : "Inactivo"}
              </span>
              {center.cif && (
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 font-medium shrink-0 tabular-nums">CIF {center.cif}</span>
              )}
            </div>
            <p className="text-sm text-gray-500">{center.address}, {center.city} ({center.province}) · {center.postalCode}</p>
            {((center.phones?.length ?? 0) > 0 || (center.emails?.length ?? 0) > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {center.phones?.map((p) => (
                  <span key={`p-${p}`} className="text-xs px-2 py-0.5 rounded-md bg-gray-50 border border-gray-100 text-gray-600">{p}</span>
                ))}
                {center.emails?.map((e) => (
                  <span key={`e-${e}`} className="text-xs px-2 py-0.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">{e}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
              {center.active ? "Desactivar" : "Activar"}
            </button>
            <button onClick={() => setEditCenter(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
            <button onClick={() => setDeleteCenter(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Eliminar</button>
            <button onClick={() => setExpanded((v) => !v)} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium">
              {expanded ? "▲ Ocultar" : `▼ ${center.rooms.length} sala${center.rooms.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>

        {/* Rooms */}
        {expanded && (
          <div className="border-t border-gray-100">
            <div className="px-5 py-3 flex items-center justify-between bg-gray-50">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Salas</p>
              <button onClick={() => setNewRoom(true)} className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">+ Nueva sala</button>
            </div>
            {center.rooms.length === 0 && (
              <p className="px-5 py-4 text-sm text-gray-400 text-center">Sin salas — crea la primera</p>
            )}
            <div className="divide-y divide-gray-50">
              {center.rooms.map((room) => (
                <div key={room.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{room.name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                        {room.schedule.openTime && <span className="text-xs text-gray-500">{room.schedule.openTime} – {room.schedule.closeTime}</span>}
                        {room.schedule.slotDuration && <span className="text-xs text-gray-500">{room.schedule.slotDuration} min/cita</span>}
                        {room.schedule.activeDays && <span className="text-xs text-gray-500">{dayLabels(room.schedule.activeDays)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setEditRoom(room)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
                      <button onClick={() => setDeleteRoom(room)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Eliminar</button>
                    </div>
                  </div>
                  <RoomScheduleCalendar schedule={room.schedule} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CentersPage() {
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const { data: centers, isLoading } = useQuery<Center[]>({
    queryKey: ["centers"],
    queryFn: () => apiFetch<Center[]>("/centers"),
  });

  const visible = (centers ?? []).filter((c) =>
    filter === "active" ? c.active : filter === "inactive" ? !c.active : true
  );

  const totalRooms = visible.reduce((s, c) => s + c.rooms.length, 0);
  const activeCount = visible.filter((c) => c.active).length;
  const inactiveCount = visible.length - activeCount;

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
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Total centros</p>
          <p className="text-2xl font-bold text-gray-800">{(centers ?? []).length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Activos</p>
          <p className="text-2xl font-bold text-emerald-700">{(centers ?? []).filter((c) => c.active).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Inactivos</p>
          <p className="text-2xl font-bold text-gray-400">{(centers ?? []).filter((c) => !c.active).length}</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Total salas</p>
          <p className="text-2xl font-bold text-blue-700">{(centers ?? []).reduce((s, c) => s + c.rooms.length, 0)}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {(["all", "active", "inactive"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${filter === f ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            {f === "all" ? "Todos" : f === "active" ? "Activos" : "Inactivos"}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Cargando centros...</p>}
      {!isLoading && visible.length === 0 && (
        <p className="text-center text-gray-400 text-sm py-12">
          {filter === "all" ? "Sin centros registrados" : `Sin centros ${filter === "active" ? "activos" : "inactivos"}`}
        </p>
      )}

      <div className="space-y-4">
        {visible.map((center) => (
          <CenterCard key={center.id} center={center} />
        ))}
      </div>
    </div>
  );
}
