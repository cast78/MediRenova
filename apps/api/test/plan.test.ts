import { describe, it, expect } from "vitest";
import { effectivePlan, features, hasFeature, parseOverrides, validateOverrides, FEATURES, FEATURE_KEYS } from "../src/lib/plan.js";

const NOW = new Date("2026-10-09T12:00:00Z");
const FUTURE = new Date("2026-11-09T12:00:00Z");
const PAST = new Date("2026-09-09T12:00:00Z");

describe("effectivePlan", () => {
  it("Esencial sin prueba → Esencial", () => expect(effectivePlan({ plan: "ESSENTIAL" }, NOW)).toBe("ESSENTIAL"));
  it("Esencial con prueba vigente → Pro", () => expect(effectivePlan({ plan: "ESSENTIAL", trialUntil: FUTURE }, NOW)).toBe("PRO"));
  it("Esencial con prueba vencida → Esencial", () => expect(effectivePlan({ plan: "ESSENTIAL", trialUntil: PAST }, NOW)).toBe("ESSENTIAL"));
  it("acepta la fecha como string ISO", () => expect(effectivePlan({ plan: "ESSENTIAL", trialUntil: FUTURE.toISOString() }, NOW)).toBe("PRO"));
  it("Pro siempre es Pro", () => expect(effectivePlan({ plan: "PRO", trialUntil: PAST }, NOW)).toBe("PRO"));
});

describe("features", () => {
  it("Esencial tiene solo las funciones de gestión", () => {
    const f = features({ plan: "ESSENTIAL" }, NOW);
    expect(f).toEqual(["portal_certificates", "analytics_basic"]);
  });
  it("Pro tiene todas", () => {
    expect(features({ plan: "PRO" }, NOW)).toEqual(FEATURE_KEYS);
  });
  it("la prueba vigente abre todas las funciones", () => {
    expect(features({ plan: "ESSENTIAL", trialUntil: FUTURE }, NOW)).toEqual(FEATURE_KEYS);
  });
  it("add incorpora la función y sus dependencias", () => {
    const f = features({ plan: "ESSENTIAL", featureOverrides: { add: ["workflow"] } }, NOW);
    expect(f).toContain("workflow");
    expect(f).toContain("public_booking");
    expect(f).not.toContain("campaigns");
  });
  it("remove quita la función y sus dependientes", () => {
    const f = features({ plan: "PRO", featureOverrides: { remove: ["messaging"] } }, NOW);
    expect(f).not.toContain("messaging");
    expect(f).not.toContain("channels");
    expect(f).toContain("campaigns");
  });
  it("claves desconocidas en overrides se ignoran", () => {
    expect(features({ plan: "ESSENTIAL", featureOverrides: { add: ["nope", 3] } }, NOW)).toEqual(["portal_certificates", "analytics_basic"]);
  });
  it("mantiene el orden del catálogo", () => {
    const f = features({ plan: "ESSENTIAL", featureOverrides: { add: ["api_public", "campaigns"] } }, NOW);
    expect(f).toEqual(FEATURE_KEYS.filter((k) => f.includes(k)));
  });
});

describe("hasFeature", () => {
  it("responde por función", () => {
    expect(hasFeature({ plan: "ESSENTIAL" }, "campaigns", NOW)).toBe(false);
    expect(hasFeature({ plan: "ESSENTIAL" }, "portal_certificates", NOW)).toBe(true);
    expect(hasFeature({ plan: "PRO" }, "campaigns", NOW)).toBe(true);
  });
});

describe("catálogo", () => {
  it("toda dependencia apunta a una función existente con plan igual o inferior", () => {
    for (const k of FEATURE_KEYS) {
      for (const r of FEATURES[k].requires ?? []) {
        expect(FEATURE_KEYS).toContain(r);
        expect(FEATURES[r].min === "ESSENTIAL" || FEATURES[k].min === "PRO").toBe(true);
      }
    }
  });
});

describe("overrides", () => {
  it("parseOverrides tolera cualquier entrada", () => {
    expect(parseOverrides(null)).toEqual({ add: [], remove: [] });
    expect(parseOverrides("x")).toEqual({ add: [], remove: [] });
    expect(parseOverrides({ add: ["campaigns", "zzz"], remove: "no" })).toEqual({ add: ["campaigns"], remove: [] });
  });
  it("validateOverrides señala claves desconocidas e incoherencias", () => {
    expect(validateOverrides(null)).toEqual([]);
    expect(validateOverrides({ add: ["campaigns"] })).toEqual([]);
    expect(validateOverrides({ add: ["foo"] })[0]).toContain("foo");
    expect(validateOverrides({ add: ["workflow"], remove: ["public_booking"] })[0]).toContain("necesita");
    expect(validateOverrides("x").length).toBe(1);
  });
});
