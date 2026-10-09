"use client";

// Módulo comercial de Captación: reutiliza el motor de analítica con mod="captacion"
// (altas por canal + efectividad de campañas). Separado de /analitica de gestión
// para no acumular pestañas ("divide y vencerás"). Plan Pro (crm-planes).
import { AnalyticsModule } from "../analitica/module";
import { useFeatures } from "@/lib/use-features";
import { LockedModule } from "@/components/locked-module";

export default function CaptacionPage() {
  const { has } = useFeatures();
  if (!has("captacion")) return <div className="p-6"><LockedModule feature="captacion" /></div>;
  return <AnalyticsModule mod="captacion" />;
}
