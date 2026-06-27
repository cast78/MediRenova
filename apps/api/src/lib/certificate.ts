import Handlebars from "handlebars";

export interface CertificateField {
  label: string;
  value: string;
}

export interface CertificateData {
  tenantName: string;
  centerName: string;
  centerLine: string;
  centerCif: string;
  patientName: string;
  patientDni: string;
  patientBirthDate: string;
  patientProvince: string;
  productName: string;
  doctorName: string;
  outcomeLabel: string;
  apto: boolean;
  completedAt: string;
  expiryDate: string;
  notes: string;
  fields: CertificateField[];
  generatedAt: string;
}

// Convierte un valor de formData a texto legible para el certificado.
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

// Mapea el schema del formulario + los datos rellenos a pares label/valor.
// Pura y testeable: tolera schema ausente o malformado.
export function mapFormFields(schema: unknown, formData: Record<string, unknown> | undefined | null): CertificateField[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields = (schema as any)?.fields;
  if (!Array.isArray(fields)) return [];
  const data = formData ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fields.map((f: any) => {
    const key = f?.key ?? f?.id ?? f?.name;
    const raw = key ? (data as Record<string, unknown>)[key] : undefined;
    return { label: String(f?.label ?? key ?? ""), value: formatValue(raw) };
  });
}

const TEMPLATE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; margin: 0; padding: 32px 40px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; }
  .org { font-size: 16px; font-weight: bold; color: #1d4ed8; }
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
  <div class="head">
    <div class="org">{{tenantName}}<small>{{centerName}} · {{centerLine}}</small></div>
    <div style="text-align:right;color:#6b7280">{{#if centerCif}}CIF: {{centerCif}}{{/if}}</div>
  </div>

  <h1>Certificado médico</h1>
  <div class="sub">{{productName}}</div>

  <div class="grid">
    <div class="row"><span class="k">Paciente</span><span class="v">{{patientName}}</span></div>
    <div class="row"><span class="k">DNI/NIE</span><span class="v">{{patientDni}}</span></div>
    <div class="row"><span class="k">Fecha nacimiento</span><span class="v">{{patientBirthDate}}</span></div>
    <div class="row"><span class="k">Provincia</span><span class="v">{{patientProvince}}</span></div>
    <div class="row"><span class="k">Fecha revisión</span><span class="v">{{completedAt}}</span></div>
    <div class="row"><span class="k">Válido hasta</span><span class="v">{{expiryDate}}</span></div>
  </div>

  <div class="result">Resultado: {{outcomeLabel}}</div>

  {{#if fields.length}}
  <div class="section">Datos del reconocimiento</div>
  <table>
    {{#each fields}}<tr><th>{{this.label}}</th><td>{{this.value}}</td></tr>{{/each}}
  </table>
  {{/if}}

  {{#if notes}}<div class="notes"><strong>Observaciones:</strong> {{notes}}</div>{{/if}}

  <div class="sign">
    <div class="box">Dr./Dra. {{doctorName}}<br>Facultativo</div>
    <div class="box">Firma del paciente</div>
  </div>

  <div class="foot">Documento generado el {{generatedAt}} · {{tenantName}}</div>
</body></html>`;

const compiled = Handlebars.compile(TEMPLATE);

// Render del certificado a HTML. Pura: no toca BD ni Puppeteer.
export function renderCertificateHtml(data: CertificateData): string {
  return compiled(data);
}
