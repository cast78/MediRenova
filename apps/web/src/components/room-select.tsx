"use client";

/**
 * Selector de sala reutilizable (Reservas y Visitas). Agrupa las salas por centro
 * (optgroup) y ofrece "Todas las salas" como opción neutra. Cuando solo hay un
 * centro, el optgroup queda con una sola cabecera — sigue siendo coherente.
 */
export interface RoomCenter {
  id: string;
  name: string;
  rooms?: { id: string; name: string }[];
}

export function RoomSelect({
  roomCenters,
  value,
  onChange,
  allLabel = "Todas las salas",
}: {
  roomCenters: RoomCenter[];
  value: string;
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[220px]"
    >
      <option value="">{allLabel}</option>
      {roomCenters.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {(c.rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
