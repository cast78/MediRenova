import puppeteer, { type Browser } from "puppeteer";
import { prisma } from "./prisma.js";
import { storage } from "./storage.js";
import { decryptDni } from "./crypto.js";
import { renderCertificateHtml, mapFormFields, type CertificateData } from "./certificate.js";

// ── Puppeteer: navegador compartido y reutilizado (task 11.5) ────────────────
// Un único Chrome headless con páginas efímeras por render. Suficiente para el
// MVP; escalable a un pool de N si el volumen lo requiere.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
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
    await page.close();
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
    fields: mapFormFields(revision.formTemplate.schema, revision.formData as Record<string, unknown>),
    generatedAt: fmtDateTime(new Date()),
  };

  const pdf = await htmlToPdf(renderCertificateHtml(data));
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
