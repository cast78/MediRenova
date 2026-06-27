import { describe, it, expect } from "vitest";
import { renderCertificateHtml, mapFormFields, formatValue, type CertificateData } from "../src/lib/certificate";

const baseData: CertificateData = {
  tenantName: "Clínica Demo",
  centerName: "Centro Madrid",
  centerLine: "Calle Serrano 45, Madrid (Madrid) · 28001",
  centerCif: "B12345674",
  patientName: "Juan Pérez",
  patientDni: "12345678Z",
  patientBirthDate: "01/01/1980",
  patientProvince: "Madrid",
  productName: "Carnet B",
  doctorName: "María García",
  outcomeLabel: "APTO",
  apto: true,
  completedAt: "27/06/2026",
  expiryDate: "27/06/2036",
  notes: "Sin observaciones",
  fields: [{ label: "Agudeza visual", value: "0.8" }],
  generatedAt: "27/06/2026 18:00",
};

describe("certificate: renderCertificateHtml (tarea 11.6)", () => {
  it("incluye los datos clave del paciente y resultado", () => {
    const html = renderCertificateHtml(baseData);
    expect(html).toContain("Juan Pérez");
    expect(html).toContain("12345678Z");
    expect(html).toContain("Carnet B");
    expect(html).toContain("APTO");
    expect(html).toContain("Agudeza visual");
    expect(html).toContain("27/06/2036");
  });

  it("escapa el HTML del input (defensa XSS de Handlebars)", () => {
    const html = renderCertificateHtml({ ...baseData, patientName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("marca color/etiqueta distinta según apto", () => {
    const noApto = renderCertificateHtml({ ...baseData, apto: false, outcomeLabel: "NO APTO" });
    expect(noApto).toContain("NO APTO");
    expect(noApto).toContain("#991b1b");
  });
});

describe("certificate: mapFormFields", () => {
  it("mapea schema.fields contra formData por key", () => {
    const schema = { fields: [{ key: "vista", label: "Vista" }, { key: "oido", label: "Oído" }] };
    const out = mapFormFields(schema, { vista: "0.9", oido: true });
    expect(out).toEqual([
      { label: "Vista", value: "0.9" },
      { label: "Oído", value: "Sí" },
    ]);
  });

  it("tolera schema ausente o malformado", () => {
    expect(mapFormFields(null, {})).toEqual([]);
    expect(mapFormFields({}, {})).toEqual([]);
    expect(mapFormFields({ fields: "x" }, {})).toEqual([]);
  });

  it("muestra — para valores vacíos", () => {
    const out = mapFormFields({ fields: [{ key: "x", label: "X" }] }, {});
    expect(out[0]!.value).toBe("—");
  });
});

describe("certificate: formatValue", () => {
  it("formatea booleanos, arrays y vacíos", () => {
    expect(formatValue(true)).toBe("Sí");
    expect(formatValue(false)).toBe("No");
    expect(formatValue(["a", "b"])).toBe("a, b");
    expect(formatValue("")).toBe("—");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue(42)).toBe("42");
  });
});
