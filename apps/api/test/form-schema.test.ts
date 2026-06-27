import { describe, it, expect } from "vitest";
import { validateFormFields, formFieldsSchema } from "../src/lib/form-schema";

describe("validateFormFields (tarea 7.2)", () => {
  it("acepta campos válidos", () => {
    expect(validateFormFields([{ name: "vista", type: "number" }, { name: "apto", type: "boolean" }])).toBeNull();
  });

  it("detecta nombres duplicados", () => {
    expect(validateFormFields([{ name: "x", type: "text" }, { name: "x", type: "text" }])).toContain("duplicado");
  });

  it("exige opciones en los campos de tipo select", () => {
    expect(validateFormFields([{ name: "tipo", type: "select" }])).toContain("opción");
    expect(validateFormFields([{ name: "tipo", type: "select", options: ["a", "b"] }])).toBeNull();
  });
});

describe("formFieldsSchema (zod)", () => {
  it("rechaza name no identificador", () => {
    expect(formFieldsSchema.safeParse([{ name: "1bad", label: "X", type: "text" }]).success).toBe(false);
  });

  it("rechaza tipos no soportados (p.ej. signature)", () => {
    expect(formFieldsSchema.safeParse([{ name: "x", label: "X", type: "signature" }]).success).toBe(false);
  });

  it("acepta un campo válido", () => {
    expect(formFieldsSchema.safeParse([{ name: "vista", label: "Agudeza", type: "number", unit: "/10" }]).success).toBe(true);
  });
});
