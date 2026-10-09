import { Sparkles } from "lucide-react";
import type { PlanTier } from "@/lib/use-features";

// Chip de plan (Esencial / Pro) para el panel de proveedor y la ficha de empresa.
export function PlanChip({ plan }: { plan: PlanTier }) {
  return plan === "PRO"
    ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"><Sparkles className="w-3 h-3" /> Pro</span>
    : <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">Esencial</span>;
}
