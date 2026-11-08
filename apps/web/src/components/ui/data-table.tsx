"use client";

// Envoltorio de tablas (crm-multidispositivo T2). Envuelve la <table> existente
// sin tocar su marcado: scroll horizontal propio con fundido en el borde cuando
// hay más columnas, ancho mínimo para que a 768 px las columnas no se aplasten,
// primera columna fija mientras se desplaza y, en táctil, filas más altas.
// En escritorio, si la tabla cabe, no cambia nada.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Ancho mínimo de la tabla en px; por debajo aparece el scroll horizontal. */
  minWidth?: number;
  /** Fija la primera columna (cabecera y celdas) mientras se desplaza. */
  stickyFirst?: boolean;
  className?: string;
}

// Solo se aplican cuando la tabla desborda: así en escritorio no hay fondos ni
// sombras añadidos. La cabecera fija toma gris si el <thead> ya es gris.
const STICKY =
  "[&_thead_th:first-child]:sticky [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-10 [&_thead_th:first-child]:bg-white [&_thead.bg-gray-50_th:first-child]:bg-gray-50 [&_thead_tr.bg-gray-50_th:first-child]:bg-gray-50 " +
  "[&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-[1] [&_tbody_td:first-child]:bg-white [&_tbody_tr:hover_td:first-child]:bg-gray-50";
const STICKY_SHADOW = "[&_td:first-child]:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)] [&_th:first-child]:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]";

export function DataTable({ children, minWidth = 640, stickyFirst = true, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ overflow: false, left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setState({
      overflow: el.scrollWidth > el.clientWidth + 2,
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);

  const sticky = stickyFirst && state.overflow ? `${STICKY} ${state.left ? STICKY_SHADOW : ""}` : "";
  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        style={{ "--dt-min": `${minWidth}px` } as CSSProperties}
        className={`overflow-x-auto [-webkit-overflow-scrolling:touch] [&>table]:min-w-[var(--dt-min)] touch:[&_tbody_td]:py-3.5 ${sticky}`}
      >
        {children}
      </div>
      <div className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent transition-opacity ${state.right ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
