import { describe, it, expect } from "vitest";
import {
  withTenantFilter,
  TENANT_SCOPED_MODELS,
  TENANT_INJECT_OPS,
} from "../src/lib/tenant-context";

const TID = "tenant-123";

describe("withTenantFilter (aislamiento multitenant, tarea 3.6)", () => {
  it("inyecta tenantId en modelo scoped + operación segura cuando hay contexto", () => {
    const out = withTenantFilter("Customer", "findMany", {}, TID);
    expect(out.where).toEqual({ tenantId: TID });
  });

  it("preserva el resto del where", () => {
    const out = withTenantFilter("Customer", "findFirst", { where: { id: "c1" } }, TID);
    expect(out.where).toEqual({ id: "c1", tenantId: TID });
  });

  it("no inyecta si no hay tenant (login / rutas públicas) — degradación segura", () => {
    const args = { where: { email: "a@b.c" } };
    expect(withTenantFilter("User", "findFirst", args, undefined)).toBe(args);
  });

  it("no inyecta en modelos NO tenant-scoped (p.ej. Tenant)", () => {
    const args = { where: {} };
    expect(withTenantFilter("Tenant", "findMany", args, TID)).toBe(args);
  });

  it("no inyecta en operaciones por clave única / escritura directa", () => {
    for (const op of ["findUnique", "findUniqueOrThrow", "update", "delete", "upsert", "create", "createMany"]) {
      const args = { where: { id: "x" } };
      expect(withTenantFilter("Customer", op, args, TID)).toBe(args);
    }
  });

  it("no sobreescribe un where que ya constriñe tenantId (respeta el filtro manual de la ruta)", () => {
    const args = { where: { tenantId: "otro-tenant", id: "x" } };
    const out = withTenantFilter("Customer", "findFirst", args, TID);
    expect(out).toBe(args);
    expect(out.where!["tenantId"]).toBe("otro-tenant");
  });

  it("inyecta en operaciones de conteo/agregación", () => {
    expect(TENANT_INJECT_OPS.has("count")).toBe(true);
    expect(withTenantFilter("Appointment", "count", {}, TID).where).toEqual({ tenantId: TID });
  });

  it("cubre exactamente los 10 modelos tenant-scoped del schema", () => {
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual([
      "ApiKey",
      "Appointment",
      "AuditLog",
      "Center",
      "Customer",
      "Product",
      "Revision",
      "TenantConfig",
      "User",
      "WorkflowRule",
    ]);
  });
});
