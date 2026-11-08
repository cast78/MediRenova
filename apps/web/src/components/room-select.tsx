"use client";

/**
 * Selector de sala reutilizable (Reservas, Visitas, Revisiones, Utilización).
 * Ofrece "Todas las salas" como opción neutra y agrupa las salas por centro
 * (optgroup) solo cuando hay varios: con un único centro (Visitas obliga a
 * elegirlo antes) la cabecera sería redundante y ocupa una línea en tablet.
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
      {roomCenters.length === 1
        ? (roomCenters[0]?.rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)
        : roomCenters.map((c) => (
          <optgroup key={c.id} label={c.name}>
            {(c.rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </optgroup>
        ))}
    </select>
  );
}
