import { describe, it, expect } from "vitest";
import {
  renderCertificateHtml,
  renderWithTemplate,
  sampleCertificateData,
  DEFAULT_CERTIFICATE_TEMPLATE,
  mapFormFields,
  formatValue,
  type CertificateData,
} from "../src/lib/certificate";

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
  doctorLicense: "28-12345",
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

  it("embebe la firma cuando se aporta signatureDataUrl (tarea 11.10)", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const html = renderCertificateHtml({ ...baseData, signatureDataUrl: url });
    expect(html).toContain(`src="${url}"`);
  });

  it("no incluye <img> de firma si no hay firma", () => {
    const html = renderCertificateHtml(baseData);
    expect(html).not.toContain('alt="firma"');
  });

  it("embebe la imagen de un campo de tipo imagen (en vez de texto)", () => {
    const url = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const html = renderCertificateHtml({
      ...baseData,
      fields: [{ label: "Foto del DNI", value: "", imageDataUrl: url }],
    });
    expect(html).toContain("Foto del DNI");
    expect(html).toContain(`<img src="${url}"`);
  });

  it("embebe la firma del médico y el nº de colegiado", () => {
    const html = renderCertificateHtml({ ...baseData, doctorSignatureDataUrl: "data:image/png;base64,AAA" });
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).toContain("Col. 28-12345");
  });
});

describe("certificate: renderWithTemplate (plantilla por producto, tarea 6.4)", () => {
  it("renderiza variables y bloques de una plantilla personalizada", () => {
    const tpl = "<h1>{{patientName}} · {{productName}}</h1>{{#if apto}}<span>OK</span>{{else}}<span>NO</span>{{/if}}";
    const html = renderWithTemplate(tpl, baseData);
    expect(html).toContain("Juan Pérez · Carnet B");
    expect(html).toContain("<span>OK</span>");
    expect(html).not.toContain("<span>NO</span>");
  });

  it("itera los campos del formulario con {{#each fields}}", () => {
    const tpl = "{{#each fields}}[{{this.label}}={{this.value}}]{{/each}}";
    expect(renderWithTemplate(tpl, baseData)).toContain("[Agudeza visual=0.8]");
  });

  it("escapa el HTML del input también en plantillas personalizadas", () => {
    const html = renderWithTemplate("<p>{{patientName}}</p>", { ...baseData, patientName: "<b>x</b>" });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("lanza si la plantilla no compila", () => {
    expect(() => renderWithTemplate("{{#if apto}}roto", baseData)).toThrow();
  });

  it("sampleCertificateData rinde tanto la plantilla por defecto como una personalizada", () => {
    const sample = sampleCertificateData();
    expect(() => renderCertificateHtml(sample)).not.toThrow();
    expect(renderWithTemplate(DEFAULT_CERTIFICATE_TEMPLATE, sample)).toContain(sample.patientName);
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
