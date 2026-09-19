import { describe, it, expect } from "vitest";
import { deriveRecoveryState, recoveryRatio } from "../src/lib/no-show-recovery.js";

describe("deriveRecoveryState", () => {
  it("recovered manda sobre cualquier seguimiento", () => {
    expect(deriveRecoveryState({ recovered: true, savedState: null })).toBe("recovered");
    expect(deriveRecoveryState({ recovered: true, savedState: "CONTACTED" })).toBe("recovered");
    expect(deriveRecoveryState({ recovered: true, savedState: "DISMISSED" })).toBe("recovered");
  });
  it("usa el estado guardado cuando no está recuperada", () => {
    expect(deriveRecoveryState({ recovered: false, savedState: "CONTACTED" })).toBe("contacted");
    expect(deriveRecoveryState({ recovered: false, savedState: "DISMISSED" })).toBe("dismissed");
  });
  it("sin registro y sin recuperar → pending", () => {
    expect(deriveRecoveryState({ recovered: false, savedState: null })).toBe("pending");
  });
});

describe("recoveryRatio", () => {
  it("porcentaje entero", () => {
    expect(recoveryRatio(0, 0)).toBe(0);
    expect(recoveryRatio(1, 4)).toBe(25);
    expect(recoveryRatio(12, 58)).toBe(21);
  });
});
