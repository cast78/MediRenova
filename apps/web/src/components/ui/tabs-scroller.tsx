"use client";

// Fila de pestañas desplazable (crm-multidispositivo T3.3). Sustituye a los
// contenedores "flex gap-1 bg-gray-100 rounded-lg p-1" (píldoras) y
// "flex gap-1 border-b" (subrayado). En escritorio se ve igual; cuando la fila
// no cabe (tablet), se desplaza en horizontal con fundido en los bordes, ajusta
// pestaña a pestaña y trae la activa (aria-selected="true") a la vista.
// Las pestañas hijas deben llevar role="tab" y aria-selected.
import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  variant?: "pills" | "underline";
  className?: string;
}

const TRACK = {
  pills: "flex gap-1 bg-gray-100 rounded-lg p-1",
  underline: "flex gap-1 border-b border-gray-200 overflow-y-hidden",
};
const FADE = {
  pills: "from-gray-100",
  underline: "from-white",
};

export function TabsScroller({ children, variant = "pills", className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
    // Trae la pestaña activa a la vista moviendo solo el carril (scrollIntoView
    // desplazaría también la página). Se repite cuando cambian las pestañas o su
    // anchura: los contadores (badges) llegan después del primer render.
    const ensureActive = () => {
      const active = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active) return;
      const start = active.offsetLeft - el.offsetLeft;
      const end = start + active.offsetWidth;
      if (start < el.scrollLeft || end > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, start - (el.clientWidth - active.offsetWidth) / 2);
      }
    };
    const refresh = () => { ensureActive(); update(); };
    refresh();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(refresh);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(refresh);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); mo.disconnect(); };
  }, []);

  const fadeBase = `pointer-events-none absolute inset-y-0 w-8 transition-opacity ${variant === "pills" ? "my-1" : ""}`;
  return (
    <div className={`relative ${variant === "pills" ? "w-fit" : ""} max-w-full ${className}`}>
      <div
        ref={ref}
        role="tablist"
        className={`${TRACK[variant]} max-w-full overflow-x-auto snap-x snap-proximity scroll-px-1 touch:[scrollbar-width:none] touch:[&::-webkit-scrollbar]:hidden [&>*]:snap-start [&>*]:shrink-0`}
      >
        {children}
      </div>
      <div className={`${fadeBase} left-0 rounded-l-lg bg-gradient-to-r ${FADE[variant]} to-transparent ${edges.left ? "opacity-100" : "opacity-0"}`} />
      <div className={`${fadeBase} right-0 rounded-r-lg bg-gradient-to-l ${FADE[variant]} to-transparent ${edges.right ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
