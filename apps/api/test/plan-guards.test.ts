import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_FEATURE } from "../src/lib/plan-guards.js";
import { FEATURES } from "../src/lib/plan.js";

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), "../src/routes");

// Módulos de rutas que son Pro enteros: deben llamar a guardModule con su clave.
const PRO_MODULES = ["campaigns", "segments", "message-templates", "workflow", "analytics", "deliveries", "public"];

// Rutas Pro dentro de módulos mixtos: deben llevar requireFeature en el fichero.
const PER_ROUTE: Record<string, string[]> = {
  "appointments.ts": ['requireFeature("recovery")'],
  "tenants.ts": ['requireFeature("channels")', 'requireFeature("api_public")'],
  "magic-link.ts": ['"public_booking"'],
  "portal.ts": ['"portal_full"'],
};

describe("guardias de plan (cobertura)", () => {
  it("toda clave de MODULE_FEATURE existe en el catálogo", () => {
    for (const k of Object.values(MODULE_FEATURE)) expect(Object.keys(FEATURES)).toContain(k);
  });

  it("todo módulo Pro está declarado y llama a guardModule", () => {
    for (const m of PRO_MODULES) {
      expect(Object.keys(MODULE_FEATURE)).toContain(m);
      const src = readFileSync(join(ROUTES, `${m}.ts`), "utf8");
      expect(src, `${m}.ts sin guardModule`).toContain(`guardModule(server, "${m}")`);
    }
  });

  it("las rutas Pro de módulos mixtos llevan su guardia", () => {
    for (const [file, needles] of Object.entries(PER_ROUTE)) {
      const src = readFileSync(join(ROUTES, file), "utf8");
      for (const n of needles) expect(src, `${file} sin ${n}`).toContain(n);
    }
  });

  it("no hay módulos de rutas desconocidos sin clasificar", () => {
    const files = readdirSync(ROUTES).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));
    // Esencial (sin guardia de módulo): todo lo que no sea Pro entero ni mixto.
    const known = new Set([...PRO_MODULES, ...Object.keys(PER_ROUTE).map((f) => f.replace(/\.ts$/, "")),
      "index", "auth", "centers", "products", "forms", "customers", "visits", "revisions", "dashboard", "users", "doctors"]);
    const unknown = files.filter((f) => !known.has(f));
    expect(unknown, `clasifica estos módulos como Esencial o Pro: ${unknown.join(", ")}`).toEqual([]);
  });
});
