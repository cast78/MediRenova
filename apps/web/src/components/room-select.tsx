"use client";

/**
 * Selector de sala reutilizable (Reservas, Visitas, Revisiones, Utilización).
 * Envoltorio del Select propio (crm-multidispositivo T4.5): "Todas las salas" como
 * opción neutra, salas agrupadas por centro con etiqueta solo cuando hay varios,
 * punto de color estable por sala (por posición en la lista) y, con varios
 * centros, el botón muestra "Sala · Centro".
 */
import { DoorOpen } from "lucide-react";
import { Select, type SelectGroup } from "@/components/ui/select";

export interface RoomCenter {
  id: string;
  name: string;
  rooms?: { id: string; name: string }[];
}

const DOTS = ["bg-blue-500", "bg-teal-500", "bg-amber-500", "bg-violet-500", "bg-rose-500", "bg-emerald-500", "bg-sky-500", "bg-orange-500"];

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
  const multi = roomCenters.length > 1;
  let i = 0;
  const groups: SelectGroup[] = roomCenters.map((c) => ({
    label: multi ? c.name : undefined,
    options: (c.rooms ?? []).map((r) => ({ value: r.id, label: r.name, dot: DOTS[i++ % DOTS.length] })),
  }));
  return (
    <Select
      value={value}
      onChange={onChange}
      groups={groups}
      emptyLabel={allLabel}
      placeholder={allLabel}
      title="Sala"
      subtitle={multi ? `${roomCenters.reduce((n, c) => n + (c.rooms?.length ?? 0), 0)} salas en ${roomCenters.length} centros` : "Filtra las citas por sala"}
      menu="right"
      icon={<DoorOpen className="w-4 h-4 text-gray-400 shrink-0" />}
      headerIcon={<DoorOpen className="w-5 h-5" />}
      renderSelected={(o, g) => (multi && g?.label ? `${o.label} · ${g.label}` : o.label)}
      className="max-w-[260px] !py-1.5 !border-gray-200 !text-gray-600"
    />
  );
}
