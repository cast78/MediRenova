// Sembrador de demo para la vista "Consulta" del médico: crea una jornada de HOY
// con pacientes en varios estados (próximo, listo, en curso, hecho), en la sala del
// médico demo (Sala 1) y una en otra sala para demostrar el filtro "Míos/Todos".
// Idempotente: borra primero las citas etiquetadas "demo-consulta" de hoy.
//   Ejecutar: pnpm --filter api exec tsx src/db/seed-consulta-demo.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CENTER = "00000000-0000-0000-0000-000000000001";
const SALA1 = "00000000-0000-0000-0000-000000000002";
const CARNET_B = "00000000-0000-0000-0000-000000000003";
const CARNET_CD = "00000000-0000-0000-0000-000000000004";

// Fecha de hoy (YYYY-MM-DD) en la zona del centro.
function todayInMadrid(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

async function main() {
  const today = todayInMadrid();
  const naive = (hhmm: string) => new Date(`${today}T${hhmm}:00.000Z`);

  const tenant = await prisma.tenant.findFirst({ where: { slug: "clinica-demo" }, select: { id: true } });
  const doctor = await prisma.user.findFirst({ where: { email: "doctor@clinica-demo.es" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { email: "admin@clinica-demo.es" }, select: { id: true } });
  if (!tenant || !doctor || !admin) throw new Error("Faltan tenant/doctor/admin demo — ejecuta el seed base primero.");
  const tenantId = tenant.id;

  const rooms = await prisma.room.findMany({ where: { centerId: CENTER, active: true }, select: { id: true, name: true } });
  const otherRoom = rooms.find((r) => r.id !== SALA1); // Sala2 si existe → para el demo "no míos"

  // Clientes demo deterministas (upsert por dniHash → idempotente).
  const NAMES = [
    ["Lucía", "Romero"], ["Carlos", "Méndez"], ["Ana", "Torres"], ["Javier", "Ruiz"],
    ["Marta", "Gil"], ["Pablo", "Serrano"], ["Elena", "Navarro"],
  ];
  const customers: { id: string }[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const dniHash = `democ-${i}`;
    const [firstName, lastName] = NAMES[i]!;
    const c = await prisma.customer.upsert({
      where: { tenantId_dniHash: { tenantId, dniHash } },
      update: { deletedAt: null },
      create: { tenantId, firstName: firstName ?? "", lastName: lastName ?? "", dniHash, email: `democ${i}@example.com`, phone: `+34600000${String(i).padStart(2, "0")}`, acceptsEmail: true, acceptsWhatsapp: true },
      select: { id: true },
    });
    customers.push(c);
  }
  const cust = (i: number) => customers[i % customers.length]!.id;

  // Plantilla de formulario (en blanco) por producto, para poder crear revisiones.
  async function formTemplateFor(productId: string): Promise<string> {
    const active = await prisma.formTemplate.findFirst({ where: { productId, isActive: true }, select: { id: true } });
    if (active) return active.id;
    const created = await prisma.formTemplate.create({
      data: { productId, name: "Formulario demo", version: 1, schema: { fields: [] }, isActive: true, createdById: admin!.id },
    });
    return created.id;
  }

  // ── Limpieza idempotente: TODAS las citas de los CLIENTES demo (cualquier día) +
  // sus visitas/revisiones, para no acumular jornadas sueltas. Los clientes demo son
  // exclusivos de este seeder → no se tocan reservas de clientes reales.
  const demoCustomerIds = customers.map((c) => c.id);
  const prev = await prisma.appointment.findMany({
    where: { tenantId, customerId: { in: demoCustomerIds } },
    select: { id: true },
  });
  const prevIds = prev.map((a) => a.id);
  if (prevIds.length) {
    await prisma.revision.deleteMany({ where: { appointmentId: { in: prevIds } } });
    await prisma.visit.deleteMany({ where: { appointmentId: { in: prevIds } } });
    await prisma.appointment.deleteMany({ where: { id: { in: prevIds } } });
    console.log(`🧹 Borradas ${prevIds.length} citas demo previas (todas las jornadas)`);
  }

  // Duración REAL actual de cada producto (no hardcodeada): la cita snapshotea la
  // duración que el producto tiene HOY, igual que haría una reserva real.
  const prods = await prisma.product.findMany({ where: { id: { in: [CARNET_B, CARNET_CD] } }, select: { id: true, slotDuration: true } });
  const durById = new Map(prods.map((p) => [p.id, p.slotDuration]));
  const durOf = (pid: string) => durById.get(pid) ?? 30;
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

  // Colocación SIN solapes: parte de las citas de hoy que ya existen (las de demo se
  // acaban de borrar arriba) y busca, por sala, el primer hueco libre desde las 09:00.
  const existing = await prisma.appointment.findMany({
    where: { tenantId, scheduledAt: { gte: naive("00:00"), lte: naive("23:59") }, status: { notIn: ["CANCELLED", "NO_SHOW", "RESCHEDULED"] } },
    select: { roomId: true, scheduledAt: true, durationMinutes: true },
  });
  const busy = new Map<string, { start: number; end: number }[]>();
  for (const a of existing) {
    const arr = busy.get(a.roomId) ?? [];
    arr.push({ start: a.scheduledAt.getTime(), end: a.scheduledAt.getTime() + a.durationMinutes * 60_000 });
    busy.set(a.roomId, arr);
  }
  const placeInRoom = (roomId: string, dur: number): Date => {
    const arr = busy.get(roomId) ?? [];
    const base = naive("09:00").getTime();
    for (let m = 0; m <= 600; m += 15) { // 09:00 … 19:00, rejilla de 15 min
      const start = base + m * 60_000, end = start + dur * 60_000;
      if (!arr.some((iv) => start < iv.end && end > iv.start)) { arr.push({ start, end }); busy.set(roomId, arr); return new Date(start); }
    }
    const start = base + 600 * 60_000; arr.push({ start, end: start + dur * 60_000 }); busy.set(roomId, arr); return new Date(start);
  };

  type State = "upcoming" | "ready_wait" | "ready_room" | "in_progress" | "done";
  const specs: { product: string; room: string; ci: number; state: State; note?: string }[] = [
    { product: CARNET_B, room: SALA1, ci: 0, state: "ready_wait", note: "Viene con acompañante" },
    { product: CARNET_CD, room: SALA1, ci: 1, state: "ready_room" },
    { product: CARNET_B, room: SALA1, ci: 2, state: "in_progress" },
    { product: CARNET_B, room: SALA1, ci: 3, state: "upcoming", note: "Trae informe oftalmológico" },
    { product: CARNET_CD, room: SALA1, ci: 4, state: "upcoming" },
    { product: CARNET_B, room: SALA1, ci: 5, state: "done" },
    { product: CARNET_CD, room: otherRoom?.id ?? SALA1, ci: 6, state: "ready_wait" },
  ];

  for (const s of specs) {
    const status = s.state === "done" ? "ATTENDED" : "CONFIRMED";
    const dur = durOf(s.product);
    const when = placeInRoom(s.room, dur);
    const appt = await prisma.appointment.create({
      data: {
        tenantId, customerId: cust(s.ci), productId: s.product, roomId: s.room,
        scheduledAt: when, durationMinutes: dur, status, source: "BACKOFFICE", notes: s.note ?? null,
      },
    });

    if (s.state === "ready_wait") {
      await prisma.visit.create({ data: { tenantId, centerId: CENTER, customerId: cust(s.ci), appointmentId: appt.id, status: "WAITING", arrivedAt: minsAgo(8) } });
    } else if (s.state === "ready_room") {
      await prisma.visit.create({ data: { tenantId, centerId: CENTER, customerId: cust(s.ci), appointmentId: appt.id, status: "IN_PROGRESS", arrivedAt: minsAgo(14), calledAt: minsAgo(4), currentRoomId: s.room } });
    } else if (s.state === "in_progress") {
      const ft = await formTemplateFor(s.product);
      await prisma.visit.create({ data: { tenantId, centerId: CENTER, customerId: cust(s.ci), appointmentId: appt.id, status: "IN_PROGRESS", arrivedAt: minsAgo(20), startedAt: minsAgo(10), currentRoomId: s.room } });
      await prisma.revision.create({ data: { tenantId, appointmentId: appt.id, customerId: cust(s.ci), productId: s.product, roomId: s.room, doctorId: doctor.id, formTemplateId: ft, outcome: "PENDING", startedAt: minsAgo(10) } });
    } else if (s.state === "done") {
      const ft = await formTemplateFor(s.product);
      const v = await prisma.visit.create({ data: { tenantId, centerId: CENTER, customerId: cust(s.ci), appointmentId: appt.id, status: "COMPLETED", arrivedAt: minsAgo(60), completedAt: minsAgo(35), currentRoomId: s.room } });
      const expiry = new Date(`${today}T00:00:00.000Z`); expiry.setFullYear(expiry.getFullYear() + 10);
      await prisma.revision.create({ data: { tenantId, appointmentId: appt.id, visitId: v.id, customerId: cust(s.ci), productId: s.product, roomId: s.room, doctorId: doctor.id, formTemplateId: ft, outcome: "APTO", startedAt: minsAgo(50), completedAt: minsAgo(35), expiryDate: expiry } });
    }
  }

  console.log(`✅ Jornada demo sembrada para ${today} (${specs.length} pacientes). Otra sala: ${otherRoom?.name ?? "(no hay 2ª sala)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => void prisma.$disconnect());
