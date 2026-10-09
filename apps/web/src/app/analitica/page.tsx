"use client";

// Analítica de gestión (operativa de centros): reutiliza el motor de módulo con
// mod="gestion". La captación (comercial) vive en /captacion con el mismo motor.
// Plan Pro (crm-planes): los KPIs operativos del Esencial viven en el Dashboard.
import { AnalyticsModule } from "./module";
import { useFeatures } from "@/lib/use-features";
import { LockedModule } from "@/components/locked-module";

export default function AnaliticaPage() {
  const { has } = useFeatures();
  if (!has("analytics_pro")) return <div className="p-6"><LockedModule feature="analytics_pro" /></div>;
  return <AnalyticsModule mod="gestion" />;
}
