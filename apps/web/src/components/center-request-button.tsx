"use client";

// "Solicitar un centro más" (crm-planes P4c): petición de tipo CENTER que el
// proveedor aprueba (amplía el límite) o rechaza. Se muestra cuando la empresa
// está al límite de centros contratados; con una petición abierta, su estado.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Clock, Check } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useFeatures } from "@/lib/use-features";

export function CenterRequestButton({ compact = false }: { compact?: boolean }) {
  const { info } = useFeatures();
  const qc = useQueryClient();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => apiFetch<{ id: string; alreadyOpen: boolean }>("/tenants/me/center-request", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { setSent(true); void qc.invalidateQueries({ queryKey: ["tenant-plan"] }); },
    onError: (e: unknown) => setError(e instanceof ApiError && Array.isArray(e.errors) && e.errors[0]?.message ? String(e.errors[0].message) : "No se pudo enviar la petición."),
  });
  if (!info) return null;
  // La petición de centro es independiente de las de plan (prueba o Pro): puede
  // coexistir con ellas. Solo se bloquea mientras haya otra de centro abierta.
  if (info.pendingCenterRequest || sent) {
    return (
      <span className={`inline-flex items-center gap-1.5 font-medium text-violet-800 bg-violet-50 border border-violet-200 rounded-lg ${compact ? "text-xs px-2.5 py-1.5" : "text-sm px-3 py-2"}`}>
        {sent ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />} Centro adicional solicitado · pendiente de aprobación
      </span>
    );
  }
  const atLimit = info.maxCenters != null && info.centersCount >= info.maxCenters;
  if (!atLimit) return null;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" onClick={() => { setError(null); ask.mutate(); }} disabled={ask.isPending}
        className={`inline-flex items-center gap-2 font-semibold rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60 ${compact ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2.5"}`}>
        {ask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />} Solicitar un centro más
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
