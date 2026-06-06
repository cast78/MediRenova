import { prisma } from "./prisma.js";

/**
 * Generates a PDF for a completed revision using Puppeteer + Handlebars.
 * Uploads to R2 and updates revision.pdfUrl.
 */
export async function generatePdf(revisionId: string): Promise<string | null> {
  const revision = await prisma.revision.findUnique({
    where: { id: revisionId },
    include: {
      formTemplate: true,
      appointment: {
        include: {
          customer: true,
          product: true,
          room: { include: { center: true } },
        },
      },
    },
  });

  if (!revision) throw new Error(`Revision ${revisionId} not found`);

  // TODO (task 11.5-11.7): Implement full PDF pipeline:
  // 1. Compile Handlebars template with revision data
  // 2. Render HTML with Puppeteer
  // 3. Upload PDF to Cloudflare R2
  // 4. Update revision.pdfUrl

  // For now, just log that this would generate a PDF
  console.log(`[pdf] Would generate PDF for revision ${revisionId} (not yet implemented)`);

  return null;
}
