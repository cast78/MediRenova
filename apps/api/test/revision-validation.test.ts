import { describe, it, expect } from "vitest";
import { missingForCompletion, type RevFieldDef } from "../src/lib/revision-validation";

const fields: RevFieldDef[] = [
  { name: "tension", label: "Tensión arterial", type: "text", required: true },
  { name: "obs", label: "Observaciones", type: "textarea", required: false },
  { name: "foto", label: "Foto DNI", type: "image", required: true },
  { name: "apto_vista", label: "Vista correcta", type: "boolean", required: true },
];

const full = {
  fields,
  formData: { tension: "12/8" } as Record<string, unknown>,
  attachmentFieldIds: ["foto", "signature"],
  notes: "Sin hallazgos",
};

describe("missingForCompletion (validación de finalización)", () => {
  it("no falta nada cuando todo está completo", () => {
    expect(missingForCompletion(full)).toEqual([]);
  });

  it("exige el formulario: sin campos no se puede finalizar", () => {
    const m = missingForCompletion({ ...full, fields: [] });
    expect(m).toContain("No hay un formulario con campos definidos para este producto");
  });

  it("lista cada campo obligatorio vacío (texto)", () => {
    const m = missingForCompletion({ ...full, formData: {} });
    expect(m).toContain("Tensión arterial");
  });

  it("exige imagen en campos imagen obligatorios", () => {
    const m = missingForCompletion({ ...full, attachmentFieldIds: ["signature"] });
    expect(m).toContain("Foto DNI (imagen)");
  });

  it("exige notas clínicas", () => {
    expect(missingForCompletion({ ...full, notes: "   " })).toContain("Notas clínicas");
    expect(missingForCompletion({ ...full, notes: null })).toContain("Notas clínicas");
  });

  it("exige firma del paciente", () => {
    const m = missingForCompletion({ ...full, attachmentFieldIds: ["foto"] });
    expect(m).toContain("Firma del paciente");
  });

  it("no exige los campos no obligatorios ni los booleanos", () => {
    const m = missingForCompletion(full);
    expect(m).not.toContain("Observaciones");
    expect(m).not.toContain("Vista correcta");
  });

  it("acumula todos los que faltan a la vez", () => {
    const m = missingForCompletion({ fields, formData: {}, attachmentFieldIds: [], notes: "" });
    expect(m).toEqual(expect.arrayContaining(["Tensión arterial", "Foto DNI (imagen)", "Notas clínicas", "Firma del paciente"]));
  });
});
