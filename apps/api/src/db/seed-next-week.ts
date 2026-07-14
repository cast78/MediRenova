// Sembrador de reservas para la PRÓXIMA SEMANA (lun→vie), para probar la vista de
// Reservas (Agenda/Lista): mezcla de Pendientes (para "pedir confirmación") y
// Confirmadas, un par con nota, a la duración real del producto y sin solapes.
// Clientes de prueba propios (dniHash "nextwk-*") → no interfiere con la demo de
// Consulta. Idempotente: borra primero las reservas de esos clientes.
//   Ejecutar: pnpm --filter api exec tsx src/db/seed-next-week.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CENTER = "00000000-0000-0000-0000-000000000001";
const SALA1 = "00000000-0000-0000-0000-000000000002";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "clinica-demo" }, select: { id: true } });
  if (!tenant) throw new Error("Falta el tenant demo — ejecuta el seed base primero.");
  const tenantId = tenant.id;

  const rooms = await prisma.room.findMany({ where: { centerId: CENTER, active: true }, select: { id: true, name: true } });
  const sala1 = rooms.find((r) => r.id === SALA1)?.id ?? rooms[0]?.id;
  if (!sala1) throw new Error("El centro demo no tiene salas activas.");
  const sala2 = rooms.find((r) => r.id !== sala1)?.id ?? sala1;

  const products = await prisma.product.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, slotDuration: true } });
  const prodB = products.find((p) => p.name.includes("A/B")) ?? products[0];
  const prodCD = products.find((p) => p.name.includes("C/D")) ?? products[0];
  if (!prodB || !prodCD) throw new Error("Faltan productos demo.");

  // Clientes de prueba (upsert idempotente por dniHash "nextwk-*").
  const NAMES = [["Roberto", "Díaz"], ["Carmen", "Ortiz"], ["Miguel", "Santos"], ["Isabel", "Ramos"], ["Fernando", "Cruz"]];
  const customers: { id: string }[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const [firstName, lastName] = NAMES[i]!;
    const c = await prisma.customer.upsert({
      where: { tenantId_dniHash: { tenantId, dniHash: `nextwk-${i}` } },
      update: { deletedAt: null },
      create: {
        tenantId, firstName: firstName ?? "", lastName: lastName ?? "", dniHash: `nextwk-${i}`,
        email: `nextwk${i}@example.com`, phone: `+34611000${pad(i)}0`, acceptsEmail: true, acceptsWhatsapp: true,
        province: "Madrid", municipality: "Madrid",
      },
      select: { id: true },
    });
    customers.push(c);
  }

  // Limpieza idempotente: reservas previas de estos clientes de prueba.
  const ids = customers.map((c) => c.id);
  const prev = await prisma.appointment.findMany({ where: { tenantId, customerId: { in: ids } }, select: { id: true } });
  if (prev.length) {
    const pids = prev.map((a) => a.id);
    await prisma.revision.deleteMany({ where: { appointmentId: { in: pids } } });
    await prisma.visit.deleteMany({ where: { appointmentId: { in: pids } } });
    await prisma.appointment.deleteMany({ where: { id: { in: pids } } });
    console.log(`🧹 Borradas ${pids.length} reservas de prueba previas`);
  }

  // Próximo lunes (si hoy es lunes, el de la semana que viene).
  const today = new Date();
  const daysUntilNextMon = ((8 - today.getDay()) % 7) || 7;
  const nextMon = new Date(today); nextMon.setDate(today.getDate() + daysUntilNextMon);

  // Plantilla de un día: salas + horas sin solape (60 min), mezcla de estados.
  const dayTemplate: { room: string; time: string; product: string; status: "PENDING" | "CONFIRMED"; ci: number; note?: string }[] = [
    { room: sala1, time: "09:00", product: prodB.id, status: "PENDING", ci: 0, note: "Renovación · trae gafas nuevas" },
    { room: sala1, time: "10:00", product: prodCD.id, status: "CONFIRMED", ci: 1 },
    { room: sala1, time: "11:00", product: prodB.id, status: "PENDING", ci: 2 },
    { room: sala2, time: "09:00", product: prodB.id, status: "PENDING", ci: 3, note: "Primera vez, viene con acompañante" },
    { room: sala2, time: "10:30", product: prodCD.id, status: "CONFIRMED", ci: 4 },
  ];

  let created = 0;
  for (let day = 0; day < 5; day++) { // lunes..viernes
    const d = new Date(nextMon); d.setDate(nextMon.getDate() + day);
    const date = ymd(d);
    for (const s of dayTemplate) {
      const prod = products.find((p) => p.id === s.product)!;
      const cust = customers[(s.ci + day) % customers.length]!;
      await prisma.appointment.create({
        data: {
          tenantId, customerId: cust.id, productId: s.product, roomId: s.room,
          scheduledAt: new Date(`${date}T${s.time}:00.000Z`), durationMinutes: prod.slotDuration,
          status: s.status, source: "BACKOFFICE", notes: day === 0 ? (s.note ?? null) : null,
        },
      });
      created++;
    }
  }

  const from = ymd(nextMon); const last = new Date(nextMon); last.setDate(nextMon.getDate() + 4);
  console.log(`✅ Sembradas ${created} reservas de prueba para la semana ${from} → ${ymd(last)}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => void prisma.$disconnect());
