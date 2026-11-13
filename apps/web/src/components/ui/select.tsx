"use client";

// Selector propio (crm-multidispositivo T4.5), sustituto del <select> nativo: el
// mismo aspecto en todos los dispositivos. Botón con la opción elegida (o el texto
// de vacío); al pulsarlo, en escritorio se abre un desplegable bajo el botón y por
// debajo de lg una hoja pequeña centrada (Modal) con cabecera propia (icono en
// recuadro suave, título y subtítulo). Opciones planas o agrupadas con etiqueta
// discreta; cada fila puede llevar icono o punto de color; marca en la elegida;
// cierre al elegir, fuera o Escape.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export interface SelectOption {
  value: string;
  label: string;
  /** Icono propio de la fila (si no, el `optionIcon` del selector). */
  icon?: ReactNode | undefined;
  /** Clase de color del punto a la izquierda (p. ej. "bg-blue-500"); sustituye al icono. */
  dot?: string | undefined;
  /** Texto secundario a la derecha. */
  hint?: string | undefined;
}

export interface SelectGroup {
  /** Etiqueta del grupo; sin ella, las opciones van sin cabecera. */
  label?: string | undefined;
  options: SelectOption[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Opciones planas… */
  options?: SelectOption[];
  /** …o agrupadas. */
  groups?: SelectGroup[];
  /** Texto del botón cuando no hay valor; también es el título de la hoja si no hay `title`. */
  placeholder: string;
  /** Si se da, el vacío es una opción elegible con este texto (p. ej. "Todas las salas"). */
  emptyLabel?: string;
  /** Título y subtítulo de la hoja en tablet. */
  title?: string;
  subtitle?: string;
  /** Icono del botón (16 px). */
  icon?: ReactNode;
  /** Icono de la cabecera de la hoja (20 px), en un recuadro azul suave. */
  headerIcon?: ReactNode;
  /** Icono por defecto de cada fila (16 px). */
  optionIcon?: ReactNode;
  /** Texto del botón para la opción elegida (por defecto, su etiqueta). */
  renderSelected?: (opt: SelectOption, group?: SelectGroup) => string;
  disabled?: boolean;
  /** Clases del botón (ancho, etc.). */
  className?: string;
  /** Desplegable: tan ancho como el botón, o fijo alineado a la derecha. */
  menu?: "button" | "right";
}

export function Select({
  value, onChange, options, groups, placeholder, emptyLabel, title, subtitle, icon, headerIcon, optionIcon, renderSelected,
  disabled = false, className = "", menu = "button",
}: Props) {
  const [open, setOpen] = useState(false);
  // Por debajo de lg el desplegable se sustituye por una hoja centrada.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Desplegable de escritorio: se cierra al pulsar fuera o con Escape.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || compact) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open, compact]);

  const allGroups: SelectGroup[] = groups ?? [{ options: options ?? [] }];
  let selected: SelectOption | undefined; let selectedGroup: SelectGroup | undefined;
  for (const g of allGroups) { const o = g.options.find((x) => x.value === value); if (o) { selected = o; selectedGroup = g; break; } }
  const label = selected ? (renderSelected ? renderSelected(selected, selectedGroup) : selected.label) : (value === "" && emptyLabel) ? emptyLabel : placeholder;
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const heading = title ?? placeholder;

  const row = (o: SelectOption) => {
    const isSel = o.value === value;
    const rowIcon = o.dot ? null : (o.icon ?? optionIcon);
    return (
      <button
        key={o.value || "__empty"}
        type="button"
        role="option"
        aria-selected={isSel}
        onClick={() => pick(o.value)}
        className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-sm text-left transition-colors ${isSel ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700 hover:bg-gray-50"}`}
      >
        {o.dot && <span className={`w-2 h-2 rounded-full shrink-0 ${o.dot}`} />}
        {rowIcon && <span className={`shrink-0 inline-flex ${isSel ? "text-blue-600" : "text-gray-400"}`}>{rowIcon}</span>}
        <span className="flex-1 truncate">{o.label}</span>
        {o.hint && !isSel && <span className="text-[11px] text-gray-400 shrink-0">{o.hint}</span>}
        {isSel && <Check className="w-4 h-4 text-blue-600 shrink-0" strokeWidth={2.5} />}
      </button>
    );
  };

  const list = (
    <div role="listbox" aria-label={heading} className="p-2">
      {emptyLabel != null && row({ value: "", label: emptyLabel })}
      {allGroups.map((g, i) => (
        <div key={g.label ?? i}>
          {g.label && <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 truncate">{g.label}</div>}
          {g.options.map(row)}
        </div>
      ))}
      {allGroups.every((g) => g.options.length === 0) && emptyLabel == null && (
        <p className="px-3 py-3 text-sm text-gray-400">Sin opciones</p>
      )}
    </div>
  );

  const hasValue = !!selected || (value === "" && !!emptyLabel);
  return (
    <div ref={wrapRef} className={`relative ${menu === "button" ? "" : "inline-block"}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 text-sm border rounded-lg pl-3 pr-2.5 py-2 bg-white text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 ${hasValue ? "text-gray-800" : "text-gray-500"} ${open ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-300 hover:bg-gray-50"} ${className}`}
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
      </button>
      {open && (compact ? (
        <Modal onClose={() => setOpen(false)} size="sm" padding="" ariaLabel={heading}>
          {/* Cabecera propia de la hoja: icono en recuadro suave, título, subtítulo y cerrar */}
          <div className="flex items-center gap-3 pl-4 pr-2 pt-3.5 pb-3 border-b border-gray-100">
            {headerIcon && <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 inline-flex items-center justify-center shrink-0">{headerIcon}</span>}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-gray-900 leading-tight truncate">{heading}</h2>
              {subtitle && <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>}
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
          {list}
        </Modal>
      ) : (
        <div className={`absolute top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-[0_12px_32px_-8px_rgba(17,24,39,0.18),0_2px_6px_rgba(17,24,39,0.06)] z-30 max-h-80 overflow-y-auto ${menu === "button" ? "left-0 right-0 min-w-[220px]" : "right-0 w-[280px]"}`}>{list}</div>
      ))}
    </div>
  );
}
