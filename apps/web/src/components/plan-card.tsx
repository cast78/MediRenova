"use client";

// Tarjeta "Tu plan" (Configuración → Empresa). Solo lectura para el Admin de la
// clínica: plan, prueba, centros, qué incluye y petición de cambio (crm-planes P3).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Building2, Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useFeatures, PLAN_LABEL } from "@/lib/use-features";
import { PlanChip } from "@/components/plan-chip";
import { SelfTrialButton } from "@/components/self-trial-button";
import { CenterRequestButton } from "@/components/center-request-button";

export function PlanCard() {
  const { info } = useFeatures();
  const [sent, setSent] = useState(false);
  const request = useMutation({
    mutationFn: () => apiFetch("/tenants/me/plan-request", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { setSent(true); void qc.invalidateQueries({ queryKey: ["tenant-plan"] }); },
  });
  const qc = useQueryClient();
  if (!info) return null;

  const trialActive = !!info.trialUntil && new Date(info.trialUntil) > new Date();
  const trialDays = trialActive ? Math.max(0, Math.ceil((new Date(info.trialUntil!).getTime() - Date.now()) / 86_400_000)) : 0;
  // Los botones de petición dependen del plan CONTRATADO: en prueba (efectivo Pro,
  // contratado Esencial) es justo cuando más sentido tiene pedir pasar a Pro.
  const isPro = info.plan === "PRO";
  const included = info.catalog.filter((c) => info.features.includes(c.key));
  const excluded = info.catalog.filter((c) => !info.features.includes(c.key));

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            Tu plan
            <PlanChip plan={info.effectivePlan} trialDaysLeft={trialActive ? trialDays : null} />
            {trialActive && <span className="text-xs text-gray-400">(plan contratado: {PLAN_LABEL[info.plan]})</span>}
          </h2>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <Building2 className="w-3.5 h-3.5 text-gray-400" />
            {info.centersCount} centro{info.centersCount === 1 ? "" : "s"}{info.maxCenters != null ? ` de ${info.maxCenters} contratado${info.maxCenters === 1 ? "" : "s"}` : " · sin límite"}
            {trialActive && info.plan === "ESSENTIAL" && <span className="text-gray-400">· al terminar la prueba vuelves a {PLAN_LABEL.ESSENTIAL}</span>}
            <CenterRequestButton compact />
          </p>
        </div>
        {!isPro && <SelfTrialButton compact />}
        {!isPro && !info.pendingRequest && (
          sent ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><Check className="w-4 h-4" /> Petición enviada</span>
          ) : (
            <button type="button" onClick={() => request.mutate()} disabled={request.isPending}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {request.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {trialActive ? "Quedarme en Pro" : "Quiero pasar a Pro"}
            </button>
          )
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Incluido</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2 text-sm text-gray-700"><Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />Agenda, visitas, consulta, reconocimientos y certificados</li>
            <li className="flex items-start gap-2 text-sm text-gray-700"><Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />Clientes, historial y RGPD</li>
            {included.map((c) => <li key={c.key} className="flex items-start gap-2 text-sm text-gray-700"><Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />{c.label}</li>)}
          </ul>
        </div>
        {excluded.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Con el plan Pro</p>
            <ul className="space-y-1.5">
              {excluded.map((c) => <li key={c.key} className="flex items-start gap-2 text-sm text-gray-500"><Lock className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />{c.label}</li>)}
            </ul>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-4">{trialActive ? "Si te quedas en Pro antes de que acabe la prueba, no notarás ningún corte: todo sigue abierto y con tus datos." : "El cambio de plan lo gestiona MediRenova. Tus datos no se tocan: al pasar a Pro, los módulos se abren al instante."}</p>
    </section>
  );
}
