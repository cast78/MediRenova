"use client";

// Analítica de gestión (operativa de centros): reutiliza el motor de módulo con
// mod="gestion". La captación (comercial) vive en /captacion con el mismo motor.
import { AnalyticsModule } from "./module";

export default function AnaliticaPage() {
  return <AnalyticsModule mod="gestion" />;
}
