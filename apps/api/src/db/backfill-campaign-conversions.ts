// Backfill de atribución de campañas (crm-captacion fase 2).
// Rellena convertedAt/convertedAppointmentId del histórico reproduciendo el hook
// markCampaignConverted sobre todas las citas en orden cronológico. Idempotente:
// se puede correr varias veces sin duplicar (solo sella destinatarios aún sin marcar).
//
// Uso (una vez, tras aplicar la migración): pnpm --filter api tsx src/db/backfill-campaign-conversions.ts
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { markCampaignConverted } from "../lib/campaign-attribution.js";

async function main() {
  const appts = await prisma.appointment.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, tenantId: true, customerId: true, createdAt: true },
  });
  console.log(`[backfill] procesando ${appts.length} citas en orden cronológico…`);
  for (const a of appts) {
    await markCampaignConverted(a.tenantId, a.customerId, a.id, a.createdAt);
  }
  const sellados = await prisma.campaignRecipient.count({ where: { convertedAt: { not: null } } });
  console.log(`[backfill] hecho · destinatarios con conversión sellada: ${sellados}`);
}

main()
  .catch((e) => { console.error("[backfill] error:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
