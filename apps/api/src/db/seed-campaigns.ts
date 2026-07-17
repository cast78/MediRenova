// Sembrador del módulo Campañas: plantillas (email/WhatsApp/SMS), segmentos
// (definición viva por caducidad) y tres campañas de ejemplo — una ENVIADA (con
// destinatarios), una BORRADOR y una PROGRAMADA — para que la vista de Campañas
// luzca con datos. Idempotente: borra por nombre lo que crea antes de recrearlo.
// Requiere el seed base (tenant) y, para los destinatarios, seed-renewals (clientes
// "renew-*" con revisiones que caducan).
//   Ejecutar: pnpm --filter api exec tsx src/db/seed-campaigns.ts
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TPL = {
  email: "Recordatorio de renovación (email)",
  whatsapp: "Aviso de caducidad (WhatsApp)",
  sms: "Recordatorio (SMS)",
};
const SEG = {
  d90: "Caducan en ≤90 días",
  d30: "Caducan en ≤30 días",
};
const CAMP = {
  sent: "Renovaciones — recordatorio julio",
  draft: "Aviso WhatsApp caducidades próximas",
  scheduled: "Recordatorio SMS — agosto",
};

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "clinica-demo" }, select: { id: true } });
  if (!tenant) throw new Error("Falta el tenant demo — ejecuta el seed base primero.");
  const tenantId = tenant.id;

  // Limpieza idempotente (respetando FKs: destinatarios → campañas → segmentos → plantillas).
  const campNames = Object.values(CAMP);
  const prevCamps = await prisma.campaign.findMany({ where: { tenantId, name: { in: campNames } }, select: { id: true } });
  if (prevCamps.length) {
    await prisma.campaignRecipient.deleteMany({ where: { campaignId: { in: prevCamps.map((c) => c.id) } } });
    await prisma.campaign.deleteMany({ where: { id: { in: prevCamps.map((c) => c.id) } } });
  }
  await prisma.segment.deleteMany({ where: { tenantId, name: { in: Object.values(SEG) } } });
  await prisma.messageTemplate.deleteMany({ where: { tenantId, name: { in: Object.values(TPL) } } });

  // Plantillas.
  const tplEmail = await prisma.messageTemplate.create({
    data: {
      tenantId, name: TPL.email, channel: "EMAIL", active: true,
      subject: "Su permiso de conducir está a punto de caducar",
      body: "Hola {nombre}, le recordamos que su aptitud médica para el permiso de conducir caduca el {caducidad}. Reserve su renovación en {centro} a través de {enlace}. Un saludo.",
    },
  });
  const tplWa = await prisma.messageTemplate.create({
    data: {
      tenantId, name: TPL.whatsapp, channel: "WHATSAPP", active: true,
      body: "Hola {nombre} 👋 Su aptitud médica caduca el {caducidad}. Reserve su renovación aquí: {enlace}",
    },
  });
  const tplSms = await prisma.messageTemplate.create({
    data: {
      tenantId, name: TPL.sms, channel: "SMS", active: true,
      body: "{centro}: su permiso caduca el {caducidad}. Renueve en {enlace}",
    },
  });

  // Segmentos (definición viva por ventana de caducidad).
  const seg90 = await prisma.segment.create({
    data: { tenantId, name: SEG.d90, definition: { expiringInDays: 90 } as Prisma.InputJsonValue },
  });
  const seg30 = await prisma.segment.create({
    data: { tenantId, name: SEG.d30, definition: { expiringInDays: 30 } as Prisma.InputJsonValue },
  });

  // Campaña ENVIADA: destinatarios = clientes con revisión que caduca (renew-*).
  const recips = await prisma.customer.findMany({
    where: { tenantId, dniHash: { startsWith: "renew-" }, deletedAt: null },
    select: { id: true, email: true, acceptsEmail: true },
  });
  const emailable = recips.filter((c) => c.acceptsEmail && c.email);
  const now = new Date();
  const sentAt = new Date(now.getTime() - 2 * 86_400_000); // hace 2 días
  const campSent = await prisma.campaign.create({
    data: {
      tenantId, name: CAMP.sent, channel: "EMAIL", templateId: tplEmail.id, segmentId: seg90.id,
      status: "SENT", sentAt,
      totalCount: emailable.length, sentCount: emailable.length, failedCount: 0,
      skippedCount: recips.length - emailable.length,
    },
  });
  if (emailable.length) {
    await prisma.campaignRecipient.createMany({
      data: emailable.map((c) => ({ campaignId: campSent.id, customerId: c.id, status: "SENT" as const, sentAt })),
    });
  }

  // Campaña BORRADOR (WhatsApp, ≤30 días) y PROGRAMADA (SMS, ≤90 días).
  await prisma.campaign.create({
    data: { tenantId, name: CAMP.draft, channel: "WHATSAPP", templateId: tplWa.id, segmentId: seg30.id, status: "DRAFT" },
  });
  const scheduledAt = new Date(now.getTime() + 14 * 86_400_000); // dentro de 2 semanas
  await prisma.campaign.create({
    data: { tenantId, name: CAMP.scheduled, channel: "SMS", templateId: tplSms.id, segmentId: seg90.id, status: "SCHEDULED", scheduledAt },
  });

  console.log(`✅ Campañas: 3 plantillas, 2 segmentos, 3 campañas (1 enviada con ${emailable.length} destinatarios, 1 borrador, 1 programada)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => void prisma.$disconnect());
