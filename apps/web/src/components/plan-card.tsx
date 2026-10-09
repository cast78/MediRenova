"use client";

// Tarjeta "Tu plan" (Configuración → Empresa). Solo lectura para el Admin de la
// clínica: plan, prueba, centros, qué incluye y petición de cambio (crm-planes P3).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Check, Lock, Building2, Send, Loader2, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useFeatures, PLAN_LABEL } from "@/lib/use-features";

export function PlanCard() {
  const { info } = useFeatures();
  const [sent, setSent] = useState(false);
  const request = useMutation({
    mutationFn: () => apiFetch("/tenants/me/plan-request", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => setSent(true),
  });
  if (!info) return null;

  const trialActive = !!info.trialUntil && new Date(info.trialUntil) > new Date();
  const trialDays = trialActive ? Math.max(0, Math.ceil((new Date(info.trialUntil!).getTime() - Date.now()) / 86_400_000)) : 0;
  const isPro = info.effectivePlan === "PRO";
  const included = info.catalog.filter((c) => info.features.includes(c.key));
  const excluded = info.catalog.filter((c) => !info.features.includes(c.key));

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            Tu plan
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${isPro ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
              <Sparkles className="w-3 h-3" /> {PLAN_LABEL[info.effectivePlan]}
            </span>
            {trialActive && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                <Clock className="w-3 h-3" /> Prueba Pro · {trialDays} día{trialDays === 1 ? "" : "s"}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-gray-400" />
            {info.centersCount} centro{info.centersCount === 1 ? "" : "s"}{info.maxCenters != null ? ` de ${info.maxCenters} contratado${info.maxCenters === 1 ? "" : "s"}` : " · sin límite"}
            {trialActive && info.plan === "ESSENTIAL" && <span className="text-gray-400">· al terminar la prueba vuelves a {PLAN_LABEL.ESSENTIAL}</span>}
          </p>
        </div>
        {!isPro && (
          sent ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><Check className="w-4 h-4" /> Petición enviada</span>
          ) : (
            <button type="button" onClick={() => request.mutate()} disabled={request.isPending}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {request.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Quiero pasar a Pro
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
      <p className="text-[11px] text-gray-400 mt-4">El cambio de plan lo gestiona MediRenova. Tus datos no se tocan: al pasar a Pro, los módulos se abren al instante.</p>
    </section>
  );
}
