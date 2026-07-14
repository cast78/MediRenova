// Editor visual del certificado: configuración por bloques → plantilla Handlebars.
// Es la ÚNICA fuente de verdad del layout del modo visual. El servidor genera la
// plantilla con configToTemplate() y la renderiza con el pipeline existente
// (renderWithTemplate). La UI edita el CertificateConfig y previsualiza pidiendo el
// HTML renderizado al servidor, así el preview es idéntico al PDF final.
import { z } from "zod";
import { renderWithTemplate, renderCertificateHtml, type CertificateData } from "./certificate.js";

export type CertificateSectionId = "patient" | "result" | "fields" | "notes" | "signatures";

export interface CertificateSection {
  id: CertificateSectionId;
  enabled: boolean;
  patientFields?: string[] | undefined; // solo para id === "patient": claves visibles, en orden
}

export interface CertificateConfig {
  accentColor: string;                   // hex, p.ej. "#1d4ed8"
  logoDataUrl?: string | null | undefined; // data:image/...;base64,... o null
  showCenter: boolean;                   // membrete (datos del centro)
  title: string;                         // "Certificado médico"
  sections: CertificateSection[];        // bloques centrales, reordenables
  showFooter: boolean;
  footerText?: string | undefined;       // vacío = pie por defecto
}

// Campos del paciente disponibles (clave → etiqueta + variable Handlebars).
export const PATIENT_FIELDS: { key: string; label: string; value: string }[] = [
  { key: "patientName", label: "Paciente", value: "{{patientName}}" },
  { key: "patientDni", label: "DNI/NIE", value: "{{patientDni}}" },
  { key: "patientBirthDate", label: "Fecha nacimiento", value: "{{patientBirthDate}}" },
  { key: "patientProvince", label: "Provincia", value: "{{patientProvince}}" },
  { key: "completedAt", label: "Fecha revisión", value: "{{completedAt}}" },
  { key: "expiryDate", label: "Válido hasta", value: "{{expiryDate}}" },
];
const PATIENT_FIELD_MAP = Object.fromEntries(PATIENT_FIELDS.map((f) => [f.key, f]));

export const DEFAULT_CERTIFICATE_CONFIG: CertificateConfig = {
  accentColor: "#1d4ed8",
  logoDataUrl: null,
  showCenter: true,
  title: "Certificado médico",
  sections: [
    { id: "patient", enabled: true, patientFields: PATIENT_FIELDS.map((f) => f.key) },
    { id: "result", enabled: true },
    { id: "fields", enabled: true },
    { id: "notes", enabled: true },
    { id: "signatures", enabled: true },
  ],
  showFooter: true,
  footerText: "",
};

// ── Validación ────────────────────────────────────────────────────────────────
const HEX = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE = /^data:image\/(png|jpe?g|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/;

export const certificateConfigSchema = z.object({
  accentColor: z.string().regex(HEX, "Color inválido"),
  logoDataUrl: z.string().regex(DATA_IMAGE, "Logo inválido").max(2_000_000).nullable().optional(),
  showCenter: z.boolean(),
  title: z.string().max(120),
  sections: z.array(z.object({
    id: z.enum(["patient", "result", "fields", "notes", "signatures"]),
    enabled: z.boolean(),
    patientFields: z.array(z.enum(["patientName", "patientDni", "patientBirthDate", "patientProvince", "completedAt", "expiryDate"])).optional(),
  })).max(20),
  showFooter: z.boolean(),
  footerText: z.string().max(500).optional(),
});

// ── Generación de la plantilla Handlebars ───────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sectionHtml(sec: CertificateSection): string {
  if (!sec.enabled) return "";
  switch (sec.id) {
    case "patient": {
      const keys = sec.patientFields && sec.patientFields.length > 0 ? sec.patientFields : PATIENT_FIELDS.map((f) => f.key);
      const rows = keys
        .map((k) => PATIENT_FIELD_MAP[k])
        .filter(Boolean)
        .map((f) => `    <div class="row"><span class="k">${esc(f!.label)}</span><span class="v">${f!.value}</span></div>`)
        .join("\n");
      return `  <div class="grid">\n${rows}\n  </div>`;
    }
    case "result":
      return `  <div class="result">Resultado: {{outcomeLabel}}</div>`;
    case "fields":
      return `  {{#if fields.length}}\n  <div class="section">Datos del reconocimiento</div>\n  <table>\n    {{#each fields}}<tr><th>{{this.label}}</th><td>{{#if this.imageDataUrl}}<img src="{{{this.imageDataUrl}}}" style="max-height:140px;max-width:100%;border-radius:4px">{{else}}{{this.value}}{{/if}}</td></tr>{{/each}}\n  </table>\n  {{/if}}`;
    case "notes":
      return `  {{#if notes}}<div class="notes"><strong>Observaciones:</strong> {{notes}}</div>{{/if}}`;
    case "signatures":
      return `  <div class="sign">\n    <div class="box">{{#if doctorSignatureDataUrl}}<img src="{{{doctorSignatureDataUrl}}}" style="max-height:46px;margin-bottom:3px" alt="firma"><br>{{/if}}Dr./Dra. {{doctorName}}{{#if doctorLicense}} · Col. {{doctorLicense}}{{/if}}<br>Facultativo</div>\n    <div class="box">{{#if signatureDataUrl}}<img src="{{{signatureDataUrl}}}" style="max-height:50px;margin-bottom:4px" alt="firma"><br>{{/if}}Firma del paciente</div>\n  </div>`;
    default:
      return "";
  }
}

// Construye una plantilla Handlebars completa a partir de la configuración visual.
export function configToTemplate(config: CertificateConfig): string {
  const accent = HEX.test(config.accentColor) ? config.accentColor : "#1d4ed8";
  const parts: string[] = [];

  if (config.showCenter) {
    const logo = config.logoDataUrl && DATA_IMAGE.test(config.logoDataUrl)
      ? `<img src="${config.logoDataUrl}" style="max-height:44px;margin-bottom:4px;display:block" alt="logo">`
      : "";
    parts.push(`  <div class="head">
    <div class="org">${logo}{{tenantName}}<small>{{centerName}} · {{centerLine}}</small></div>
    <div style="text-align:right;color:#6b7280">{{#if centerCif}}CIF: {{centerCif}}{{/if}}</div>
  </div>`);
  }

  parts.push(`  <h1>${esc(config.title || "Certificado médico")}</h1>
  <div class="sub">{{productName}}</div>`);

  for (const sec of config.sections) {
    const html = sectionHtml(sec);
    if (html) parts.push(html);
  }

  if (config.showFooter) {
    const footer = config.footerText && config.footerText.trim()
      ? esc(config.footerText.trim())
      : "Documento generado el {{generatedAt}} · {{tenantName}}";
    parts.push(`  <div class="foot">${footer}</div>`);
  }

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; margin: 0; padding: 32px 40px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${accent}; padding-bottom: 12px; }
  .org { font-size: 16px; font-weight: bold; color: ${accent}; }
  .org small { display: block; font-weight: normal; color: #6b7280; font-size: 11px; margin-top: 2px; }
  h1 { font-size: 18px; text-align: center; margin: 28px 0 4px; }
  .sub { text-align: center; color: #6b7280; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 16px 0; }
  .row { display: flex; gap: 8px; }
  .row .k { color: #6b7280; min-width: 110px; }
  .row .v { font-weight: bold; }
  .result { margin: 20px 0; padding: 14px 18px; border-radius: 8px; text-align: center; font-size: 16px; font-weight: bold;
            border: 2px solid {{#if apto}}#16a34a{{else}}#dc2626{{/if}}; color: {{#if apto}}#166534{{else}}#991b1b{{/if}}; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  th { color: #6b7280; font-weight: normal; width: 45%; }
  .notes { margin-top: 14px; padding: 10px 12px; background: #f9fafb; border-radius: 6px; font-size: 11px; }
  .sign { margin-top: 48px; display: flex; justify-content: space-between; }
  .sign .box { width: 45%; text-align: center; border-top: 1px solid #9ca3af; padding-top: 6px; color: #6b7280; }
  .foot { margin-top: 36px; text-align: center; color: #9ca3af; font-size: 10px; }
  .section { font-size: 12px; font-weight: bold; color: #374151; margin: 22px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
</style></head><body>
${parts.join("\n\n")}
</body></html>`;
}

// Resuelve el HTML del certificado según la prioridad: config visual > plantilla HTML
// > plantilla por defecto del sistema. Nunca lanza: si algo falla, cae a la por defecto.
export function resolveCertificateHtml(
  source: { certificateConfig?: unknown; certificateTemplate?: string | null },
  data: CertificateData,
): string {
  const cfg = source.certificateConfig;
  if (cfg && typeof cfg === "object") {
    const parsed = certificateConfigSchema.safeParse(cfg);
    if (parsed.success) {
      try {
        return renderWithTemplate(configToTemplate(parsed.data), data);
      } catch {
        return renderCertificateHtml(data);
      }
    }
  }
  if (source.certificateTemplate && source.certificateTemplate.trim()) {
    try {
      return renderWithTemplate(source.certificateTemplate, data);
    } catch {
      return renderCertificateHtml(data);
    }
  }
  return renderCertificateHtml(data);
}
