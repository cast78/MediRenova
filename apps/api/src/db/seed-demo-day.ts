// Sembrador de la AGENDA DEL DÍA DE LA DEMO (fecha fija DEMO_DATE): un día completo
// de reservas en ambas salas, mezcla de Pendientes y Confirmadas, con la duración
// real del producto y sin solapes. Puebla la vista de Reservas (Día/Lista) y la de
// Utilización para esa fecha. Las Confirmadas quedan listas para hacer check-in EN
// VIVO durante la demo (mostrar el flujo llegada → sala). Clientes propios
// (dniHash "demoday-*"). Idempotente: borra primero las reservas de esos clientes.
//   Ejecutar: pnpm --filter api exec tsx src/db/seed-demo-day.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_DATE = "2026-07-16"; // jueves de la demo — cámbialo si se mueve la fecha
const CENTER = "00000000-0000-0000-0000-000000000001";
const SALA1 = "00000000-0000-0000-0000-000000000002";
const pad = (n: number) => String(n).padStart(2, "0");

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "clinica-demo" }, select: { id: true } });
  if (!tenant) throw new Error("Falta el tenant demo — ejecuta el seed base primero.");
  const tenantId = tenant.id;

  const rooms = await prisma.room.findMany({ where: { centerId: CENTER, active: true }, select: { id: true } });
  const sala1 = rooms.find((r) => r.id === SALA1)?.id ?? rooms[0]?.id;
  if (!sala1) throw new Error("El centro demo no tiene salas activas.");
  const sala2 = rooms.find((r) => r.id !== sala1)?.id ?? sala1;

  const products = await prisma.product.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, slotDuration: true } });
  const prodB = products.find((p) => p.name.includes("A/B")) ?? products[0];
  const prodCD = products.find((p) => p.name.includes("C/D")) ?? products[0];
  if (!prodB || !prodCD) throw new Error("Faltan productos demo.");

  // Clientes de prueba propios (upsert idempotente por dniHash "demoday-*").
  const NAMES = [
    ["Andrés", "Molina"], ["Beatriz", "Herrera"], ["Cristóbal", "Vega"], ["Diana", "Prieto"],
    ["Emilio", "Castaño"], ["Federica", "Lozano"], ["Gonzalo", "Ibáñez"], ["Helena", "Bravo"], ["Ignacio", "Rueda"],
  ];
  const customers: { id: string }[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const [firstName, lastName] = NAMES[i]!;
    const birthDate = new Date(`${1960 + i * 4}-05-12`); // edades variadas
    const c = await prisma.customer.upsert({
      where: { tenantId_dniHash: { tenantId, dniHash: `demoday-${i}` } },
      update: { deletedAt: null, birthDate },
      create: {
        tenantId, firstName: firstName ?? "", lastName: lastName ?? "", dniHash: `demoday-${i}`, birthDate,
        email: `demoday${i}@example.com`, phone: `+34633000${pad(i)}0`, acceptsEmail: true, acceptsWhatsapp: true,
        province: "Madrid", municipality: "Madrid",
      },
      select: { id: true },
    });
    customers.push(c);
  }

  // Limpieza idempotente: reservas previas de estos clientes.
  const ids = customers.map((c) => c.id);
  const prev = await prisma.appointment.findMany({ where: { tenantId, customerId: { in: ids } }, select: { id: true } });
  if (prev.length) {
    const pids = prev.map((a) => a.id);
    await prisma.revision.deleteMany({ where: { appointmentId: { in: pids } } });
    await prisma.visit.deleteMany({ where: { appointmentId: { in: pids } } });
    await prisma.appointment.deleteMany({ where: { id: { in: pids } } });
    console.log(`🧹 Borradas ${pids.length} reservas previas del día de la demo`);
  }

  // Agenda del día: dos salas, horas sin solape, mezcla de estados. Las Confirmadas
  // están listas para check-in en vivo; las Pendientes para "pedir confirmación".
  const agenda: { room: string; time: string; product: string; status: "PENDING" | "CONFIRMED"; ci: number; note?: string }[] = [
    { room: sala1, time: "09:00", product: prodB.id, status: "CONFIRMED", ci: 0, note: "Renovación permiso B · trae gafas nuevas" },
    { room: sala1, time: "10:00", product: prodCD.id, status: "PENDING", ci: 1 },
    { room: sala1, time: "11:00", product: prodB.id, status: "CONFIRMED", ci: 2 },
    { room: sala1, time: "12:00", product: prodCD.id, status: "PENDING", ci: 3, note: "Trae informe oftalmológico" },
    { room: sala1, time: "13:00", product: prodB.id, status: "CONFIRMED", ci: 4 },
    { room: sala2, time: "09:00", product: prodB.id, status: "PENDING", ci: 5, note: "Primera vez, viene con acompañante" },
    { room: sala2, time: "10:00", product: prodCD.id, status: "CONFIRMED", ci: 6 },
    { room: sala2, time: "11:00", product: prodB.id, status: "CONFIRMED", ci: 7 },
    { room: sala2, time: "12:00", product: prodB.id, status: "PENDING", ci: 8 },
  ];

  let created = 0;
  for (const s of agenda) {
    const prod = products.find((p) => p.id === s.product)!;
    await prisma.appointment.create({
      data: {
        tenantId, customerId: customers[s.ci % customers.length]!.id, productId: s.product, roomId: s.room,
        scheduledAt: new Date(`${DEMO_DATE}T${s.time}:00.000Z`), durationMinutes: prod.slotDuration,
        status: s.status, source: "BACKOFFICE", notes: s.note ?? null,
      },
    });
    created++;
  }

  console.log(`✅ Sembradas ${created} reservas para el día de la demo (${DEMO_DATE})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => void prisma.$disconnect());
