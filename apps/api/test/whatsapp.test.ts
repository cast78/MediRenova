import { describe, it, expect } from "vitest";
import { buildTemplatePayload, normalizePhone } from "../src/lib/whatsapp";

describe("normalizePhone", () => {
  it("deja solo dígitos (E.164 sin +)", () => {
    expect(normalizePhone("+34 600 11 22 33")).toBe("34600112233");
    expect(normalizePhone("(91) 123-45-67")).toBe("911234567");
  });
});

describe("buildTemplatePayload (Meta Cloud API, tarea 12.5)", () => {
  it("construye el payload de plantilla con parámetros de body", () => {
    const p = buildTemplatePayload({
      to: "+34 600 112 233",
      templateName: "medirenova_renewal",
      bodyParams: ["https://app/link/abc"],
    });
    expect(p).toMatchObject({
      messaging_product: "whatsapp",
      to: "34600112233",
      type: "template",
      template: {
        name: "medirenova_renewal",
        language: { code: "es" },
        components: [{ type: "body", parameters: [{ type: "text", text: "https://app/link/abc" }] }],
      },
    });
  });

  it("omite components cuando no hay parámetros", () => {
    const p = buildTemplatePayload({ to: "34600", templateName: "t", bodyParams: [] }) as {
      template: { components: unknown[] };
    };
    expect(p.template.components).toEqual([]);
  });

  it("permite idioma personalizado", () => {
    const p = buildTemplatePayload({ to: "34600", templateName: "t", bodyParams: [], languageCode: "en" }) as {
      template: { language: { code: string } };
    };
    expect(p.template.language.code).toBe("en");
  });
});
