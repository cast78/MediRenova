// Cliente de email. Mismo patrón que whatsapp.ts / storage:
//  - ResendEmailClient: envía vía HTTP API de Resend (producción, tras env vars).
//  - LogEmailClient: registra en consola (desarrollo / sin credenciales).
// Cambiar de proveedor = otra clase con el mismo interface; el resto no cambia.

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string; // texto plano; se manda como `text` y como `html` básico
}

export interface EmailClient {
  // Lanza si el envío falla (para que la campaña lo marque FAILED).
  sendEmail(params: SendEmailParams): Promise<void>;
}

// Resend expone un endpoint HTTP simple, así que no hace falta ninguna SDK
// (igual que Meta en whatsapp.ts). Otro proveedor = otra clase con este interface.
class ResendEmailClient implements EmailClient {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendEmail(params: SendEmailParams): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: params.to,
        subject: params.subject,
        text: params.body,
        html: params.body.replace(/\n/g, "<br>"),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend API ${res.status}: ${text}`);
    }
  }
}

class LogEmailClient implements EmailClient {
  async sendEmail(params: SendEmailParams): Promise<void> {
    console.log(
      `[email:dev] -> ${params.to} subject="${params.subject}" body=${JSON.stringify(params.body.slice(0, 120))}`,
    );
  }
}

function emailIsConfigured(): boolean {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["EMAIL_FROM"];
  return !!apiKey && !!from && !apiKey.startsWith("your-");
}

function createEmailClient(): EmailClient {
  return emailIsConfigured() ? new ResendEmailClient(process.env["RESEND_API_KEY"]!, process.env["EMAIL_FROM"]!) : new LogEmailClient();
}

export const email: EmailClient = createEmailClient();
// Estado real del canal email (env del servidor), para la Configuración y "Probar conexión".
export const emailConfigured: boolean = emailIsConfigured();
export const emailFrom: string | null = process.env["EMAIL_FROM"] ?? null;

// Sustituye variables {{clave}} de una plantilla por sus valores. Las claves sin
// valor se dejan vacías. Compartido por avisos manuales y campañas.
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}
