"use client";

// Diálogo de confirmación de cambio de plan (crm-planes P4b): resume qué gana o
// pierde la clínica, la facturación resultante y cierra la petición abierta.
// El motivo es obligatorio: queda en la auditoría.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Lock, Check, X, Loader2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { PLAN_LABEL, type PlanTier, type FeatureKey } from "@/lib/use-features";

export interface CatalogEntry { key: FeatureKey; label: string; min: PlanTier }

export function PlanChangeDialog({ tenant, to, catalog, onClose, onDone }: {
  tenant: { id: string; name: string; plan: PlanTier; centersCount: number; openRequests: number; adminName?: string | null };
  to: PlanTier;
  catalog: CatalogEntry[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toPro = to === "PRO";
  const proOnly = catalog.filter((c) => c.min === "PRO");

  const save = useMutation({
    mutationFn: () => apiFetch(`/superadmin/tenants/${tenant.id}`, { method: "PATCH", body: JSON.stringify({ plan: to, reason: reason.trim(), closeOpenRequests: toPro }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["superadmin-tenants"] });
      void qc.invalidateQueries({ queryKey: ["superadmin-tenant", tenant.id] });
      void qc.invalidateQueries({ queryKey: ["superadmin-plan-requests"] });
      void qc.invalidateQueries({ queryKey: ["tenant-plan"] });
      onDone?.(); onClose();
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? `Error ${e.status}` : "No se pudo guardar"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/45 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-labelledby="plan-dialog-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-xl inline-flex items-center justify-center ${toPro ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{toPro ? <Sparkles className="w-5 h-5" /> : <Lock className="w-5 h-5" />}</span>
          <h2 id="plan-dialog-title" className="text-lg font-semibold text-gray-900 flex-1">{toPro ? `Pasar ${tenant.name} a Pro` : `Cambiar ${tenant.name} a Esencial`}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-gray-600">{toPro ? "Desde hoy la clínica tendrá abiertos estos módulos, sin tocar ninguno de sus datos:" : "Desde hoy estos módulos quedarán bloqueados para la clínica. Sus datos se conservan y vuelven a verse si regresa a Pro:"}</p>
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-800">
          {proOnly.map((c) => (
            <li key={c.key} className="flex items-start gap-1.5">{toPro ? <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> : <Lock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}{c.label}</li>
          ))}
        </ul>

        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-gray-600 space-y-0.5">
          <div>Facturación: <b className="text-gray-900">plan {PLAN_LABEL[to]} × {tenant.centersCount} centro{tenant.centersCount === 1 ? "" : "s"}</b>.</div>
          {toPro && tenant.openRequests > 0 && <div>La petición abierta{tenant.adminName ? ` de ${tenant.adminName}` : ""} se cerrará automáticamente.</div>}
          <div>Plan actual: {PLAN_LABEL[tenant.plan]}.</div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-gray-600">Motivo <span className="text-red-600">*</span> <span className="text-gray-400 font-normal">(queda en la auditoría)</span></span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={toPro ? "p. ej. contrato Pro firmado el 10/10" : "p. ej. fin de contrato Pro"} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className={`block mt-1 text-[11px] ${reason.trim().length > 0 && reason.trim().length < 3 ? "text-amber-700" : "text-gray-400"}`}>
            {reason.trim().length > 0 && reason.trim().length < 3 ? "Escribe un motivo un poco más explicativo (mínimo 3 caracteres)." : "Obligatorio: así sabrás dentro de meses por qué se hizo este cambio."}
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending || reason.trim().length < 3} title={reason.trim().length < 3 ? "Escribe el motivo para poder confirmar" : undefined}
            className={`inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 ${toPro ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-600 hover:bg-amber-700"}`}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {toPro ? "Confirmar: pasar a Pro" : "Confirmar: cambiar a Esencial"}
          </button>
        </div>
      </div>
    </div>
  );
}
