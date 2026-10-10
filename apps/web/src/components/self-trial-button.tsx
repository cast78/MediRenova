"use client";

// Petición de prueba Pro de 14 días (crm-planes P4c.1, opción B): la clínica la
// PIDE y el proveedor la aprueba o rechaza desde su panel; nada se activa solo.
// También muestra el estado de cualquier petición pendiente (prueba o Pro).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, Clock, Check } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useFeatures } from "@/lib/use-features";

export function SelfTrialButton({ compact = false }: { compact?: boolean }) {
  const { info } = useFeatures();
  const qc = useQueryClient();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => apiFetch<{ id: string; alreadyOpen: boolean }>("/tenants/me/trial", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { setSent(true); void qc.invalidateQueries({ queryKey: ["tenant-plan"] }); },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError && Array.isArray(e.errors) && e.errors[0]?.message ? String(e.errors[0].message) : "No se pudo enviar la petición.";
      setError(msg);
    },
  });

  const pending = info?.pendingRequest ?? null;
  if (pending?.kind === "CENTER") return null; // la muestra CenterRequestButton
  if (pending || sent) {
    const isTrial = pending ? pending.kind === "TRIAL" : true;
    return (
      <span className={`inline-flex items-center gap-1.5 font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg ${compact ? "text-xs px-2.5 py-1.5" : "text-sm px-3 py-2"}`}>
        {sent ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
        {isTrial ? "Prueba Pro solicitada · pendiente de aprobación" : "Petición de plan Pro enviada · te contactaremos"}
      </span>
    );
  }
  if (!info?.selfTrialAvailable) return null;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" onClick={() => { setError(null); ask.mutate(); }} disabled={ask.isPending}
        className={`inline-flex items-center gap-2 font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60 ${compact ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2.5"}`}>
        {ask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Pedir prueba Pro de 14 días
      </button>
      {!compact && <span className="text-xs text-gray-400">Sin compromiso: la aprobamos en breve y al acabar vuelves a Esencial con tus datos intactos.</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
