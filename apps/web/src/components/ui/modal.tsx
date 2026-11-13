"use client";

// Diálogo común (crm-multidispositivo T5). En escritorio (≥ lg) es el diálogo
// centrado de siempre: fondo oscuro, panel blanco redondeado con ancho máximo.
// Por debajo de lg (tablet vertical) los diálogos grandes pasan a HOJA a pantalla
// completa (100dvh): cabecera y pie fijos, cuerpo con scroll, de modo que las
// acciones quedan siempre al alcance del pulgar y el teclado en pantalla no las tapa.
// Los diálogos pequeños (confirmaciones) siguen centrados también en tablet.
//
// Uso mínimo (el contenido tal cual, sin cabecera ni pie propios):
//   <Modal onClose={onClose} size="md">…</Modal>
// Con cabecera y pie fijos:
//   <Modal onClose={onClose} size="lg" title="Nuevo cliente" footer={<>…botones…</>}>…</Modal>
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export type ModalSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "5xl";

const MAX_W: Record<ModalSize, string> = {
  xs: "max-w-xs", sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "4xl": "max-w-4xl", "5xl": "max-w-5xl",
};
// A partir de lg el diálogo es un formulario largo: en tablet va a pantalla completa.
const SHEET_BY_DEFAULT: Record<ModalSize, boolean> = {
  xs: false, sm: false, md: false, lg: true, xl: true, "2xl": true, "4xl": true, "5xl": true,
};

interface Props {
  children: ReactNode;
  /** Cierre por fondo, botón X y Escape. Sin él, el diálogo no se cierra desde fuera. */
  onClose?: () => void;
  size?: ModalSize;
  /** Hoja a pantalla completa en < lg. Por defecto sí para lg o más, no para xs–md. */
  sheet?: boolean;
  /** Cabecera fija: título (y botón de cerrar si hay onClose). */
  title?: ReactNode;
  /** Pie fijo con las acciones. */
  footer?: ReactNode;
  /** Capa; los diálogos anidados usan una mayor. */
  z?: 40 | 50 | 60 | 80;
  /** Opacidad del fondo. */
  backdrop?: "light" | "normal" | "dark";
  /** Relleno del panel cuando no hay cabecera ni pie (por defecto p-6). */
  padding?: string;
  /** Clases extra del panel (p. ej. rounded-2xl). */
  className?: string;
  /** Clases extra del cuerpo con scroll (modo cabecera/pie). */
  bodyClassName?: string;
  /** Deshabilita el cierre por fondo/Escape (p. ej. mientras se guarda). */
  locked?: boolean;
  /** Etiqueta accesible cuando no hay título visible. */
  ariaLabel?: string;
}

const Z = { 40: "z-40", 50: "z-50", 60: "z-[60]", 80: "z-[80]" } as const;
const BACKDROP = { light: "bg-black/30", normal: "bg-black/40", dark: "bg-black/70" } as const;

export function Modal({
  children, onClose, size = "md", sheet, title, footer, z = 50, backdrop = "normal",
  padding = "p-6", className = "", bodyClassName = "", locked = false, ariaLabel,
}: Props) {
  const asSheet = sheet ?? SHEET_BY_DEFAULT[size];
  const close = () => { if (onClose && !locked) onClose(); };

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, locked]);

  const structured = title != null || footer != null;
  // Hoja: en < lg el panel ocupa toda la pantalla (clases sheet-* de globals.css;
  // las variantes max-lg: de Tailwind no están disponibles con pantallas "raw").
  const panelShape = `${asSheet ? "sheet-panel" : ""} rounded-xl max-h-[90vh] ${MAX_W[size]}`;

  return (
    <div className={`fixed inset-0 ${Z[z]} ${BACKDROP[backdrop]} flex items-center justify-center p-4 ${asSheet ? "sheet-overlay" : ""}`} onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : ariaLabel}
        className={`bg-white shadow-xl w-full flex flex-col overflow-hidden ${panelShape} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {structured ? (
          <>
            {title != null && (
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 shrink-0">
                <h2 className="text-base font-semibold text-gray-900 flex-1 min-w-0 truncate">{title}</h2>
                {onClose && (
                  <button type="button" onClick={close} aria-label="Cerrar" className="-mr-2 w-10 h-10 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
            <div className={`flex-1 overflow-y-auto px-5 py-4 ${bodyClassName}`}>{children}</div>
            {footer != null && (
              <div className="modal-foot flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0 bg-white">
                {footer}
              </div>
            )}
          </>
        ) : (
          <div className={`relative flex-1 overflow-y-auto ${padding} ${asSheet ? "sheet-body" : ""} ${bodyClassName}`}>{children}</div>
        )}
      </div>
    </div>
  );
}
