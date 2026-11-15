"use client";

// Aviso global de "función fuera del plan" (crm-planes P3.7). Escucha el evento
// que emite apiFetch con cada 403 FEATURE_NOT_IN_PLAN, muestra un aviso sobrio
// con el mensaje de la API y el camino para resolverlo, y vuelve a leer el plan
// (candados del menú) por si el bloqueo viene de un cambio reciente.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Sparkles, X } from "lucide-react";
import { PLAN_BLOCKED_EVENT, type PlanBlockedDetail } from "@/lib/api";

const SHOW_MS = 9_000;

export function PlanBlockedToast() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<PlanBlockedDetail | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastKey = "", lastAt = 0;
    const onBlocked = (e: Event) => {
      const d = (e as CustomEvent<PlanBlockedDetail>).detail;
      // Varias llamadas de la misma pantalla fallan a la vez: un solo aviso.
      const key = d.feature ?? d.message;
      if (key === lastKey && Date.now() - lastAt < 3_000) return;
      lastKey = key; lastAt = Date.now();
      setToast(d);
      void qc.invalidateQueries({ queryKey: ["tenant-plan"] });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), SHOW_MS);
    };
    window.addEventListener(PLAN_BLOCKED_EVENT, onBlocked);
    return () => { window.removeEventListener(PLAN_BLOCKED_EVENT, onBlocked); if (timer) clearTimeout(timer); };
  }, [qc]);

  if (!toast) return null;
  return (
    <div role="status" className="fixed top-4 right-4 z-[60] max-w-sm bg-white border border-blue-200 rounded-xl shadow-lg px-4 py-3.5 flex items-start gap-3 text-sm">
      <span aria-hidden className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 inline-flex items-center justify-center shrink-0"><Lock className="w-4 h-4" /></span>
      <div className="min-w-0 flex flex-col gap-1.5">
        <span className="font-semibold text-gray-900">Función del plan Pro</span>
        <span className="text-[13px] text-gray-600 leading-relaxed">{toast.message}</span>
        <Link href="/settings" onClick={() => setToast(null)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:underline"><Sparkles className="w-3.5 h-3.5" /> Ver mi plan →</Link>
      </div>
      <button type="button" onClick={() => setToast(null)} aria-label="Cerrar aviso" className="-mr-1 -mt-1 w-8 h-8 rounded-lg inline-flex items-center justify-center text-gray-400 hover:bg-gray-100 shrink-0"><X className="w-4 h-4" /></button>
    </div>
  );
}
