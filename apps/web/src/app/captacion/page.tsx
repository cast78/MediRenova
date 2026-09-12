"use client";

// Módulo comercial de Captación: reutiliza el motor de analítica con mod="captacion"
// (altas por canal + efectividad de campañas). Separado de /analitica de gestión
// para no acumular pestañas ("divide y vencerás").
import { AnalyticsModule } from "../analitica/module";

export default function CaptacionPage() {
  return <AnalyticsModule mod="captacion" />;
}
