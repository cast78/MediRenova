// Sembrador de RENOVACIONES: clientes con certificado APTO caducando pronto, para que
// el Dashboard (Caducidades próximas / Sin reserva), Revisiones (Próximas a caducar) y
// los certificados con fecha luzcan con datos reales. Idempotente por dniHash "renew-*".
//   Ejecutar: pnpm --filter api exec tsx src/db/seed-renewals.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CENTER = "00000000-0000-0000-0000-000000000001";
const SALA1 = "00000000-0000-0000-0000-000000000002";
const CARNET_B = "00000000-0000-0000-0000-000000000003";
const CARNET_CD = "00000000-0000-0000-0000-000000000004";

const daysFromNow = (n: number): Date => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "clinica-demo" }, select: { id: true } });
  const doctor = await prisma.user.findFirst({ where: { email: "doctor@clinica-demo.es" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { email: "admin@clinica-demo.es" }, select: { id: true } });
  if (!tenant || !doctor || !admin) throw new Error("Faltan tenant/doctor/admin — ejecuta el seed base primero.");
  const tenantId = tenant.id;

  async function formTemplateFor(productId: string): Promise<string> {
    const active = await prisma.formTemplate.findFirst({ where: { productId, isActive: true }, select: { id: true } });
    if (active) return active.id;
    const created = await prisma.formTemplate.create({ data: { productId, name: "Formulario demo", version: 1, schema: { fields: [] }, isActive: true, createdById: admin!.id } });
    return created.id;
  }
  const validityByProduct: Record<string, number> = { [CARNET_B]: 3650, [CARNET_CD]: 1825 };

  // [nombre, apellido, año nac., producto, días hasta caducar, ¿tiene renovación reservada?]
  const SPECS: [string, string, number, string, number, boolean][] = [
    ["Rosa", "Delgado", 1958, CARNET_B, 15, false],
    ["Tomás", "Vega", 1985, CARNET_CD, 25, false],
    ["Nuria", "Prieto", 1970, CARNET_B, 45, false],
    ["Alberto", "Ibáñez", 1952, CARNET_CD, 70, true],
    ["Sofía", "Herrera", 1990, CARNET_B, 85, false],
  ];

  const customers: string[] = [];
  for (let i = 0; i < SPECS.length; i++) {
    const [firstName, lastName, year] = SPECS[i]!;
    const birthDate = new Date(`${year}-05-10`);
    const c = await prisma.customer.upsert({
      where: { tenantId_dniHash: { tenantId, dniHash: `renew-${i}` } },
      update: { deletedAt: null, birthDate },
      create: { tenantId, firstName, lastName, dniHash: `renew-${i}`, birthDate, email: `renew${i}@example.com`, phone: `+34622000${String(i).padStart(2, "0")}0`, acceptsEmail: true, acceptsWhatsapp: true, province: "Madrid", municipality: "Madrid" },
      select: { id: true },
    });
    customers.push(c.id);
  }

  // Limpieza idempotente de todo lo de estos clientes.
  const prev = await prisma.appointment.findMany({ where: { tenantId, customerId: { in: customers } }, select: { id: true } });
  if (prev.length) {
    const pids = prev.map((a) => a.id);
    await prisma.revision.deleteMany({ where: { appointmentId: { in: pids } } });
    await prisma.visit.deleteMany({ where: { appointmentId: { in: pids } } });
    await prisma.appointment.deleteMany({ where: { id: { in: pids } } });
  }

  const prods = await prisma.product.findMany({ where: { id: { in: [CARNET_B, CARNET_CD] } }, select: { id: true, slotDuration: true } });
  const durOf = (pid: string) => prods.find((p) => p.id === pid)?.slotDuration ?? 30;

  let created = 0;
  for (let i = 0; i < SPECS.length; i++) {
    const [, , , product, days, hasBooking] = SPECS[i]!;
    const expiry = daysFromNow(days);
    const issued = new Date(expiry); issued.setDate(issued.getDate() - (validityByProduct[product] ?? 3650)); // certificado original
    const ft = await formTemplateFor(product);
    const dur = durOf(product);

    // Cita original atendida + revisión APTO caducando (con fecha de caducidad explícita).
    const appt = await prisma.appointment.create({
      data: { tenantId, customerId: customers[i]!, productId: product, roomId: SALA1, scheduledAt: issued, durationMinutes: dur, status: "ATTENDED", source: "BACKOFFICE" },
    });
    const v = await prisma.visit.create({ data: { tenantId, centerId: CENTER, customerId: customers[i]!, appointmentId: appt.id, status: "COMPLETED", arrivedAt: issued, completedAt: issued } });
    await prisma.revision.create({ data: { tenantId, appointmentId: appt.id, visitId: v.id, customerId: customers[i]!, productId: product, roomId: SALA1, doctorId: doctor.id, formTemplateId: ft, outcome: "APTO", startedAt: issued, completedAt: issued, expiryDate: expiry } });
    created++;

    // Algunos ya tienen su renovación reservada (→ "Reservado", fuera de "Sin reserva").
    if (hasBooking) {
      const future = daysFromNow(days - 3);
      await prisma.appointment.create({ data: { tenantId, customerId: customers[i]!, productId: product, roomId: SALA1, scheduledAt: future, durationMinutes: dur, status: "CONFIRMED", source: "BACKOFFICE" } });
    }
  }
  console.log(`✅ Sembradas ${created} renovaciones (caducan a 15/25/45/70/85 días; 1 con reserva futura).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => void prisma.$disconnect());
