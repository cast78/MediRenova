import puppeteer, { type Browser } from "puppeteer";
import { prisma } from "./prisma.js";
import { storage } from "./storage.js";
import { decryptDni } from "./crypto.js";
import { mapFormFields, type CertificateData } from "./certificate.js";
import { resolveCertificateHtml } from "./certificate-config.js";

// ── Puppeteer: navegador compartido y reutilizado (task 11.5) ────────────────
// Un único Chrome headless con páginas efímeras por render. Suficiente para el
// MVP; escalable a un pool de N si el volumen lo requiere.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  // Reutiliza la instancia solo si sigue conectada; si murió (p.ej. inactividad,
  // crash), la descarta y relanza una nueva. Evita el "Protocol error: Connection
  // closed." que dejaba el singleton inservible hasta reiniciar el proceso.
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {
      // el lanzamiento previo falló; relanzamos abajo
    }
    browserPromise = null;
  }
  // En producción (Railway) se usa el Chromium del sistema vía
  // PUPPETEER_EXECUTABLE_PATH; en local, el Chromium que trae puppeteer.
  const executablePath = process.env["PUPPETEER_EXECUTABLE_PATH"] || undefined;
  browserPromise = puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    ...(executablePath ? { executablePath } : {}),
  });
  return browserPromise;
}

async function renderOnce(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  try {
    return await renderOnce(html);
  } catch (err) {
    // Si el navegador compartido se cerró/desconectó entre renders, lo reseteamos
    // y reintentamos una vez con una instancia fresca.
    if (err instanceof Error && /Connection closed|Protocol error|Target closed|disconnected|Session closed/i.test(err.message)) {
      browserPromise = null;
      return await renderOnce(html);
    }
    throw err;
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

// ── Formato ──────────────────────────────────────────────────────────────────
function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

// ── Generación ───────────────────────────────────────────────────────────────

// Genera el PDF del certificado de una revisión, lo almacena y guarda la key en
// revision.pdfUrl. Devuelve el buffer. Lanza si la revisión no existe.
export async function generatePdf(revisionId: string): Promise<Buffer> {
  const revision = await prisma.revision.findUnique({
    where: { id: revisionId },
    include: {
      formTemplate: true,
      doctor: true,
      appointment: { include: { customer: true, product: true, room: { include: { center: true } } } },
    },
  });
  if (!revision) throw new Error(`Revision ${revisionId} not found`);

  const tenant = await prisma.tenant.findUnique({ where: { id: revision.tenantId } });
  const customer = revision.appointment.customer;
  const center = revision.appointment.room.center;

  let dni = "—";
  if (customer.dniEncrypted) {
    try {
      dni = decryptDni(customer.dniEncrypted);
    } catch {
      dni = "(cifrado)";
    }
  }

  // Firma del paciente (adjunto con fieldId="signature"), embebida como data URL.
  let signatureDataUrl: string | undefined;
  const signature = await prisma.revisionAttachment.findFirst({
    where: { revisionId, fieldId: "signature" },
    orderBy: { createdAt: "desc" },
  });
  if (signature) {
    try {
      const bytes = await storage.get(signature.r2Key);
      signatureDataUrl = `data:${signature.mimeType};base64,${bytes.toString("base64")}`;
    } catch {
      // firma ausente en storage → se omite
    }
  }

  // Firma del médico (guardada en su perfil) embebida en el certificado.
  let doctorSignatureDataUrl: string | undefined;
  if (revision.doctor.signatureKey) {
    try {
      const bytes = await storage.get(revision.doctor.signatureKey);
      const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes.subarray(0, 4).toString("latin1") === "RIFF" ? "image/webp" : "image/png";
      doctorSignatureDataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      // firma del médico ausente → se omite
    }
  }

  // Campos del certificado. Para los de tipo "image" embebemos el adjunto del
  // campo (fieldId = nombre del campo) como data URL en lugar de texto.
  const schemaFields = (((revision.formTemplate.schema as { fields?: unknown[] })?.fields) ?? []) as { name?: string; type?: string }[];
  const certFields = mapFormFields(revision.formTemplate.schema, revision.formData as Record<string, unknown>);
  const imageFieldNames = schemaFields.filter((f) => f?.type === "image" && f?.name).map((f) => f.name as string);
  if (imageFieldNames.length > 0) {
    const atts = await prisma.revisionAttachment.findMany({
      where: { revisionId, fieldId: { in: imageFieldNames } },
      orderBy: { createdAt: "desc" },
    });
    const latestByField = new Map<string, (typeof atts)[number]>();
    for (const a of atts) if (!latestByField.has(a.fieldId)) latestByField.set(a.fieldId, a);
    for (let i = 0; i < schemaFields.length; i++) {
      const f = schemaFields[i];
      const cf = certFields[i];
      if (!cf || f?.type !== "image" || !f?.name) continue;
      const att = latestByField.get(f.name);
      if (att) {
        try {
          const bytes = await storage.get(att.r2Key);
          cf.imageDataUrl = `data:${att.mimeType};base64,${bytes.toString("base64")}`;
          cf.value = "";
        } catch {
          cf.value = "—";
        }
      } else {
        cf.value = "—";
      }
    }
  }

  const data: CertificateData = {
    tenantName: tenant?.name ?? "MediRenova",
    centerName: center.name,
    centerLine: `${center.address}, ${center.city} (${center.province}) · ${center.postalCode}`,
    centerCif: center.cif ?? "",
    patientName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "—",
    patientDni: dni,
    patientBirthDate: fmtDate(customer.birthDate),
    patientProvince: customer.province ?? "—",
    productName: revision.appointment.product.name,
    doctorName: [revision.doctor.firstName, revision.doctor.lastName].filter(Boolean).join(" ") || "—",
    outcomeLabel: String(revision.outcome).replace(/_/g, " "),
    apto: revision.outcome === "APTO",
    completedAt: fmtDate(revision.completedAt),
    expiryDate: fmtDate(revision.expiryDate),
    notes: revision.notes ?? "",
    fields: certFields,
    generatedAt: fmtDateTime(new Date()),
    signatureDataUrl,
    doctorLicense: revision.doctor.licenseNumber ?? "",
    doctorSignatureDataUrl,
  };

  // Prioridad: config del editor visual > plantilla HTML del producto > por defecto.
  // Nunca lanza: si algo falla, cae a la por defecto para no bloquear la emisión.
  const html = resolveCertificateHtml(revision.appointment.product, data);

  const pdf = await htmlToPdf(html);
  const key = `tenants/${revision.tenantId}/revisions/${revision.id}.pdf`;
  await storage.put(key, pdf, "application/pdf");
  await prisma.revision.update({ where: { id: revisionId }, data: { pdfUrl: key } });
  return pdf;
}

// Devuelve los bytes del PDF de la revisión, generándolo si aún no existe.
// Validada por tenant antes de generar.
export async function ensureRevisionPdf(revisionId: string, tenantId: string): Promise<Buffer> {
  const revision = await prisma.revision.findFirst({ where: { id: revisionId, tenantId } });
  if (!revision) throw new Error("REVISION_NOT_FOUND");
  if (revision.pdfUrl) {
    try {
      return await storage.get(revision.pdfUrl);
    } catch {
      // archivo ausente (p.ej. storage local reseteado) → regenerar
    }
  }
  return generatePdf(revisionId);
}
