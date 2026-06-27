// Cliente de WhatsApp (tarea 12.5). Abstracción con dos adaptadores:
//  - MetaWhatsAppClient: Meta Cloud API (producción, tras env vars).
//  - LogWhatsAppClient: registra en consola (desarrollo / sin credenciales).
// Mismo patrón que `Storage`: el resto del código no cambia al activar Meta.

export interface SendTemplateParams {
  to: string;
  templateName: string;
  bodyParams: string[];
  languageCode?: string;
}

export interface WhatsAppClient {
  // Lanza si el envío falla (para que el workflow lo marque FAILED y reintente).
  sendTemplate(params: SendTemplateParams): Promise<void>;
}

// Normaliza a solo dígitos (E.164 sin '+'), como espera la Cloud API.
export function normalizePhone(to: string): string {
  return to.replace(/\D/g, "");
}

// Construye el payload de plantilla de la Meta Cloud API. Pura y testeable.
export function buildTemplatePayload(params: SendTemplateParams): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to: normalizePhone(params.to),
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.languageCode ?? "es" },
      components: params.bodyParams.length
        ? [{ type: "body", parameters: params.bodyParams.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };
}

class MetaWhatsAppClient implements WhatsAppClient {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  async sendTemplate(params: SendTemplateParams): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildTemplatePayload(params)),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta WhatsApp API ${res.status}: ${text}`);
    }
  }
}

class LogWhatsAppClient implements WhatsAppClient {
  async sendTemplate(params: SendTemplateParams): Promise<void> {
    console.log(
      `[whatsapp:dev] -> ${normalizePhone(params.to)} template=${params.templateName} params=${JSON.stringify(params.bodyParams)}`,
    );
  }
}

function createWhatsAppClient(): WhatsAppClient {
  const phoneNumberId = process.env["META_WA_PHONE_NUMBER_ID"];
  const accessToken = process.env["META_WA_ACCESS_TOKEN"];
  const configured =
    !!phoneNumberId && !!accessToken && !phoneNumberId.startsWith("your-") && !accessToken.startsWith("your-");
  return configured ? new MetaWhatsAppClient(phoneNumberId!, accessToken!) : new LogWhatsAppClient();
}

export const whatsapp: WhatsAppClient = createWhatsAppClient();
