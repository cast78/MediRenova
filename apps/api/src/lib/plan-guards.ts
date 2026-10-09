// Guardias de plan por módulo (crm-planes P2). Un módulo de rutas Pro se protege
// entero con `guardModule(server, "campaigns")` al principio de su función de
// registro: Fastify encapsula el hook en ese plugin, así que solo afecta a sus
// rutas. La lista MODULE_FEATURE es la referencia que el test de cobertura
// comprueba (todo módulo Pro declarado tiene su guardia y su clave existe).
import type { FastifyInstance } from "fastify";
import { requireFeature } from "./authorization.js";
import type { FeatureKey } from "./plan.js";

export const MODULE_FEATURE = {
  campaigns: "campaigns",
  segments: "campaigns",
  "message-templates": "campaigns",
  workflow: "workflow",
  analytics: "analytics_pro",
  deliveries: "messaging",
  public: "public_booking",
} as const satisfies Record<string, FeatureKey>;

export type GuardedModule = keyof typeof MODULE_FEATURE;

export function guardModule(server: FastifyInstance, module: GuardedModule): void {
  server.addHook("preHandler", requireFeature(MODULE_FEATURE[module]));
}
