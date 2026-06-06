"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

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
  address: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  rooms: Room[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function dayLabels(days?: number[]) {
  if (!days || days.length === 0) return "—";
  return days.map((d) => DAYS[d]).join(", ");
}

// ── Center Modal ──────────────────────────────────────────────────────────────

interface CenterFormData {
  name: string; address: string; city: string; province: string; postalCode: string; phone: string; email: string;
}
const EMPTY_CENTER: CenterFormData = { name: "", address: "", city: "", province: "", postalCode: "", phone: "", email: "" };

function CenterModal({ center, onClose }: { center?: Center; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CenterFormData>(
    center ? { name: center.name, address: center.address, city: center.city, province: center.province, postalCode: center.postalCode, phone: center.phone ?? "", email: center.email ?? "" }
      : EMPTY_CENTER
  );
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!center;

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { name: form.name, address: form.address, city: form.city, province: form.province, postalCode: form.postalCode };
      if (form.phone) body["phone"] = form.phone;
      if (form.email) body["email"] = form.email;
      return isEdit
        ? apiFetch(`/centers/${center!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch("/centers", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["centers"] }); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Error al guardar"),
  });

  function field(label: string, key: keyof CenterFormData, required = false, type = "text") {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && " *"}</label>
        <input type={type} required={required} value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? "Editar centro" : "Nuevo centro"}</h2>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
          {field("Nombre", "name", true)}
          {field("Dirección", "address", true)}
          <div className="grid grid-cols-2 gap-3">{field("Ciudad", "city", true)}{field("Provincia", "province", true)}</div>
          <div className="grid grid-cols-2 gap-3">{field("Código postal", "postalCode", true)}{field("Teléfono", "phone")}</div>
          {field("Email", "email", false, "email")}
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
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Error al guardar"),
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
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="font-semibold text-gray-900 truncate">{center.name}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${center.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {center.active ? "Activo" : "Inactivo"}
              </span>
            </div>
            <p className="text-sm text-gray-500">{center.address}, {center.city} ({center.province}) · {center.postalCode}</p>
            {(center.phone || center.email) && (
              <p className="text-xs text-gray-400 mt-0.5">{[center.phone, center.email].filter(Boolean).join(" · ")}</p>
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
                <div key={room.id} className="px-5 py-3 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{room.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {room.schedule.openTime && <span className="text-xs text-gray-500">🕐 {room.schedule.openTime} – {room.schedule.closeTime}</span>}
                      {room.schedule.slotDuration && <span className="text-xs text-gray-500">⏱ {room.schedule.slotDuration} min</span>}
                      {room.schedule.activeDays && <span className="text-xs text-gray-500">📅 {dayLabels(room.schedule.activeDays)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setEditRoom(room)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
                    <button onClick={() => setDeleteRoom(room)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-500">Eliminar</button>
                  </div>
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

  return (
    <div className="p-6">
      {showModal && <CenterModal onClose={() => setShowModal(false)} />}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Centros</h1>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          + Nuevo centro
        </button>
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
