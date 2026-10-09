// Planes Esencial / Pro (crm-planes). NÚCLEO PURO, sin BD: el catálogo de
// funciones del producto con su plan mínimo y dependencias, y la resolución de
// qué funciones tiene una empresa (plan + prueba vigente + excepciones).
// Cambiar una frontera comercial = editar una línea de FEATURES.

export type PlanTier = "ESSENTIAL" | "PRO";

const PLAN_RANK: Record<PlanTier, number> = { ESSENTIAL: 1, PRO: 2 };

export const PLAN_LABEL: Record<PlanTier, string> = { ESSENTIAL: "Esencial", PRO: "Pro" };

export type FeatureKey =
  | "portal_certificates"
  | "portal_full"
  | "analytics_basic"
  | "analytics_pro"
  | "captacion"
  | "messaging"
  | "recovery"
  | "campaigns"
  | "workflow"
  | "public_booking"
  | "api_public"
  | "channels";

export interface FeatureDef {
  min: PlanTier;
  label: string;
  requires?: FeatureKey[];
}

// Orden del catálogo = orden estable de salida de `features()`.
export const FEATURES: Record<FeatureKey, FeatureDef> = {
  portal_certificates: { min: "ESSENTIAL", label: "Portal del paciente: certificados" },
  portal_full: { min: "PRO", label: "Portal del paciente: citas y renovación", requires: ["portal_certificates"] },
  analytics_basic: { min: "ESSENTIAL", label: "KPIs operativos" },
  analytics_pro: { min: "PRO", label: "Analítica avanzada (embudo, fugas, drill-down)" },
  captacion: { min: "PRO", label: "Captación (efectividad de campañas)", requires: ["campaigns"] },
  messaging: { min: "PRO", label: "Avisos automáticos y Comunicaciones" },
  recovery: { min: "PRO", label: "Recuperación de no-shows" },
  campaigns: { min: "PRO", label: "Campañas y segmentos" },
  workflow: { min: "PRO", label: "Renovación automática", requires: ["public_booking"] },
  public_booking: { min: "PRO", label: "Reserva pública y auto-reserva por enlace" },
  api_public: { min: "PRO", label: "API e integraciones" },
  channels: { min: "PRO", label: "Canales de mensajería (WhatsApp, email, SMS)", requires: ["messaging"] },
};

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(k: unknown): k is FeatureKey {
  return typeof k === "string" && k in FEATURES;
}

export interface Overrides { add: FeatureKey[]; remove: FeatureKey[] }

// Excepciones por empresa guardadas como Json: { "add": [...], "remove": [...] }.
// Tolerante: claves desconocidas se ignoran (no rompen la resolución).
export function parseOverrides(raw: unknown): Overrides {
  const out: Overrides = { add: [], remove: [] };
  if (!raw || typeof raw !== "object") return out;
  const o = raw as { add?: unknown; remove?: unknown };
  if (Array.isArray(o.add)) out.add = o.add.filter(isFeatureKey);
  if (Array.isArray(o.remove)) out.remove = o.remove.filter(isFeatureKey);
  return out;
}

// Lo mínimo que hace falta de una empresa para resolver su plan.
export interface PlanInput {
  plan: PlanTier;
  trialUntil?: Date | string | null;
  featureOverrides?: unknown;
}

// Plan efectivo: Pro mientras haya una prueba vigente; si no, el contratado.
export function effectivePlan(t: PlanInput, now: Date = new Date()): PlanTier {
  if (t.trialUntil) {
    const until = t.trialUntil instanceof Date ? t.trialUntil : new Date(t.trialUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() > now.getTime()) return "PRO";
  }
  return t.plan;
}

// Dependencias transitivas de una función (lo que necesita para funcionar).
function requiresOf(key: FeatureKey, acc = new Set<FeatureKey>()): Set<FeatureKey> {
  for (const r of FEATURES[key].requires ?? []) {
    if (!acc.has(r)) { acc.add(r); requiresOf(r, acc); }
  }
  return acc;
}

// Dependientes transitivos de una función (quién la necesita).
function dependentsOf(key: FeatureKey, acc = new Set<FeatureKey>()): Set<FeatureKey> {
  for (const k of FEATURE_KEYS) {
    if ((FEATURES[k].requires ?? []).includes(key) && !acc.has(k)) { acc.add(k); dependentsOf(k, acc); }
  }
  return acc;
}

// Funciones disponibles: las del plan efectivo, + añadidas (con sus dependencias),
// − quitadas (con sus dependientes). Orden estable del catálogo.
export function features(t: PlanInput, now: Date = new Date()): FeatureKey[] {
  const rank = PLAN_RANK[effectivePlan(t, now)];
  const set = new Set<FeatureKey>(FEATURE_KEYS.filter((k) => PLAN_RANK[FEATURES[k].min] <= rank));
  const o = parseOverrides(t.featureOverrides);
  for (const k of o.add) { set.add(k); for (const r of requiresOf(k)) set.add(r); }
  for (const k of o.remove) { set.delete(k); for (const d of dependentsOf(k)) set.delete(d); }
  return FEATURE_KEYS.filter((k) => set.has(k));
}

export function hasFeature(t: PlanInput, key: FeatureKey, now: Date = new Date()): boolean {
  return features(t, now).includes(key);
}

// Validación de excepciones para el panel de proveedor: claves desconocidas y
// combinaciones incoherentes (quitar algo de lo que depende otra función añadida).
export function validateOverrides(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw == null) return errors;
  if (typeof raw !== "object") return ["featureOverrides debe ser un objeto { add, remove }"];
  const o = raw as { add?: unknown; remove?: unknown };
  for (const [name, list] of [["add", o.add], ["remove", o.remove]] as const) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) { errors.push(`${name} debe ser una lista`); continue; }
    for (const k of list) if (!isFeatureKey(k)) errors.push(`Función desconocida en ${name}: ${String(k)}`);
  }
  const parsed = parseOverrides(raw);
  for (const k of parsed.add) {
    for (const r of requiresOf(k)) if (parsed.remove.includes(r)) errors.push(`${k} necesita ${r}, que está en remove`);
  }
  return errors;
}
