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
}

export const PLAN_LABEL: Record<PlanTier, string> = { ESSENTIAL: "Esencial", PRO: "Pro" };

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
