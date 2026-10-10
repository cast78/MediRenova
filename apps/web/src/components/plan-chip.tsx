import { Sparkles, Leaf, Clock } from "lucide-react";
import type { PlanTier } from "@/lib/use-features";

// Chip de plan, único para toda la app (menú lateral, "Tu plan", panel de
// proveedor). Código de color: Esencial verde · Pro azul · Prueba Pro ámbar
// (naranja la última semana). La prueba nunca usa verde para no confundirse
// con Esencial.
export function PlanChip({ plan, trialDaysLeft, size = "md" }: { plan: PlanTier; trialDaysLeft?: number | null; size?: "sm" | "md" }) {
  const base = `inline-flex items-center gap-1 font-semibold rounded-full border whitespace-nowrap ${size === "sm" ? "text-[10px] px-1.5 py-0" : "text-[11px] px-2 py-0.5"}`;
  const ico = size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3";
  if (trialDaysLeft != null) {
    const urgent = trialDaysLeft <= 7;
    return (
      <span className={`${base} ${urgent ? "bg-orange-100 text-orange-800 border-orange-300" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
        <Clock className={ico} /> Prueba Pro · {trialDaysLeft} d
      </span>
    );
  }
  return plan === "PRO"
    ? <span className={`${base} bg-blue-50 text-blue-700 border-blue-200`}><Sparkles className={ico} /> Pro</span>
    : <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}><Leaf className={ico} /> Esencial</span>;
}
