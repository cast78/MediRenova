"use client";

// Plan y funciones de la empresa (crm-planes). Alimenta el menú (candados), las
// páginas bloqueadas y la tarjeta "Tu plan". Una sola consulta, cacheada.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type PlanTier = "ESSENTIAL" | "PRO";
export type FeatureKey =
  | "portal_certificates" | "portal_full" | "analytics_basic" | "analytics_pro" | "captacion"
  | "messaging" | "recovery" | "campaigns" | "workflow" | "public_booking" | "api_public" | "channels";

export interface PlanInfo {
  plan: PlanTier;
  effectivePlan: PlanTier;
  trialUntil: string | null;
  features: FeatureKey[];
  centersCount: number;
  maxCenters: number | null;
  catalog: { key: FeatureKey; label: string; min: PlanTier }[];
  // true cuando el superadmin está en "Ver como Pro" (vista previa, no persiste).
  preview?: boolean;
}

export const PLAN_LABEL: Record<PlanTier, string> = { ESSENTIAL: "Esencial", PRO: "Pro" };

// Código de color de una prueba por días RESTANTES (no por duración): ≤7 naranja
// (hay que llamar), ≤30 ámbar, >30 verde. Lo usan la barra del superadmin y el panel.
export function trialTone(daysLeft: number): { bar: string; chip: string; label: string } {
  // Tonos pastel: fondo claro con texto oscuro (legible, sin estridencias).
  if (daysLeft <= 7) return { bar: "bg-orange-100 text-orange-900 border-b border-orange-200", chip: "bg-orange-100 text-orange-800 border-orange-300", label: "vence pronto" };
  if (daysLeft <= 30) return { bar: "bg-amber-100 text-amber-900 border-b border-amber-200", chip: "bg-amber-100 text-amber-800 border-amber-300", label: "en curso" };
  return { bar: "bg-emerald-100 text-emerald-900 border-b border-emerald-200", chip: "bg-emerald-100 text-emerald-800 border-emerald-300", label: "recién empezada" };
}
export function trialDaysLeft(trialUntil: string | null | undefined): number | null {
  if (!trialUntil) return null;
  const ms = new Date(trialUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : null;
}

export function useFeatures() {
  const q = useQuery<PlanInfo>({
    queryKey: ["tenant-plan"],
    queryFn: () => apiFetch<PlanInfo>("/tenants/me/plan"),
    staleTime: 5 * 60_000,
  });
  const set = new Set<FeatureKey>(q.data?.features ?? []);
  return {
    info: q.data ?? null,
    loading: q.isLoading,
    // Mientras carga, se asume que SÍ (evita parpadeo de candados en Pro, que es el caso común).
    has: (key: FeatureKey) => (q.data ? set.has(key) : true),
  };
}
