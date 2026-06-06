import { PrismaClient, UserRole } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { createCipheriv, scryptSync } from "crypto";
import { hash } from "bcrypt";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

async function main() {
  console.log("🌱 Seeding MediRenova...");

  // ─── Superadmin Tenant ────────────────────────────────────────
  const superTenant = await prisma.tenant.upsert({
    where: { slug: "system" },
    update: {},
    create: {
      name: "System",
      slug: "system",
      config: {
        create: {
          primaryColor: "#2563eb",
          secondaryColor: "#64748b",
          timezone: "Europe/Madrid",
          defaultSlotDuration: 20,
        },
      },
    },
  });
  console.log("✓ System tenant:", superTenant.id);

  // ─── Demo Tenant ──────────────────────────────────────────────
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: "clinica-demo" },
    update: {},
    create: {
      name: "Clínica Demo",
      slug: "clinica-demo",
      config: {
        create: {
          primaryColor: "#0ea5e9",
          secondaryColor: "#6366f1",
          timezone: "Europe/Madrid",
          defaultSlotDuration: 20,
        },
      },
    },
  });
  console.log("✓ Demo tenant:", demoTenant.id);

  // ─── Superadmin User ──────────────────────────────────────────
  // NOTE: bcrypt not yet installed. Using SHA-256 placeholder for seed.
  // Use bcrypt for password hashing
  const passwordHash = await hash("Admin1234!", 12);

  const superadmin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: superTenant.id, email: "admin@medirenova.es" } },
    update: { passwordHash },
    create: {
      tenantId: superTenant.id,
      email: "admin@medirenova.es",
      passwordHash,
      firstName: "Super",
      lastName: "Admin",
      role: UserRole.SUPERADMIN,
    },
  });
  console.log("✓ Superadmin:", superadmin.email);

  // ─── Demo Admin ───────────────────────────────────────────────
  const demoAdmin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: "admin@clinica-demo.es" } },
    update: { passwordHash },
    create: {
      tenantId: demoTenant.id,
      email: "admin@clinica-demo.es",
      passwordHash,
      firstName: "Admin",
      lastName: "Demo",
      role: UserRole.ADMIN,
    },
  });
  console.log("✓ Demo admin:", demoAdmin.email);

  // ─── Demo Doctor ──────────────────────────────────────────────
  const demoDoctor = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: "doctor@clinica-demo.es" } },
    update: { passwordHash },
    create: {
      tenantId: demoTenant.id,
      email: "doctor@clinica-demo.es",
      passwordHash,
      firstName: "María",
      lastName: "García",
      role: UserRole.DOCTOR,
    },
  });
  console.log("✓ Demo doctor:", demoDoctor.email);

  // ─── Demo Center ──────────────────────────────────────────────
  const demoCenter = await prisma.center.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      tenantId: demoTenant.id,
      name: "Centro Madrid Salamanca",
      address: "Calle Serrano 45",
      city: "Madrid",
      province: "Madrid",
      postalCode: "28001",
      phone: "+34 91 123 45 67",
      email: "madrid@clinica-demo.es",
      lat: 40.4168,
      lng: -3.7038,
    },
  });
  console.log("✓ Demo center:", demoCenter.name);

  // ─── Demo Room ────────────────────────────────────────────────
  const demoRoom = await prisma.room.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      centerId: demoCenter.id,
      name: "Sala 1",
      allowedProductTypes: ["CARNET_CONDUCIR", "DNI"],
      // Monday–Friday 09:00–14:00
      schedule: [
        { dayOfWeek: 1, startTime: "09:00", endTime: "14:00" },
        { dayOfWeek: 2, startTime: "09:00", endTime: "14:00" },
        { dayOfWeek: 3, startTime: "09:00", endTime: "14:00" },
        { dayOfWeek: 4, startTime: "09:00", endTime: "14:00" },
        { dayOfWeek: 5, startTime: "09:00", endTime: "14:00" },
      ],
    },
  });
  console.log("✓ Demo room:", demoRoom.name);

  // ─── Assign doctor to room ────────────────────────────────────
  await prisma.roomDoctor.upsert({
    where: { roomId_userId: { roomId: demoRoom.id, userId: demoDoctor.id } },
    update: {},
    create: { roomId: demoRoom.id, userId: demoDoctor.id },
  });
  console.log("✓ Doctor assigned to room");

  // ─── Demo Product: Carnet B ───────────────────────────────────
  const carnetB = await prisma.product.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      tenantId: demoTenant.id,
      name: "Carnet de Conducir (A/B/B+E)",
      type: "CARNET_CONDUCIR",
      slotDuration: 20,
      renewalRules: [
        { ageMin: 0,  ageMax: 64, validityYears: 10, categories: ["A", "B", "B+E"] },
        { ageMin: 65, ageMax: 70, validityYears: 5,  categories: ["A", "B", "B+E"] },
        { ageMin: 71, ageMax: 999,validityYears: 2,  categories: ["A", "B", "B+E"] },
      ],
    },
  });
  console.log("✓ Product:", carnetB.name);

  // ─── Demo Product: Carnet C/D ─────────────────────────────────
  const carnetCD = await prisma.product.upsert({
    where: { id: "00000000-0000-0000-0000-000000000004" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000004",
      tenantId: demoTenant.id,
      name: "Carnet de Conducir (C/D)",
      type: "CARNET_CONDUCIR",
      slotDuration: 30,
      renewalRules: [
        { ageMin: 0,  ageMax: 44, validityYears: 5, categories: ["C", "C+E", "D", "D+E"] },
        { ageMin: 45, ageMax: 64, validityYears: 3, categories: ["C", "C+E", "D", "D+E"] },
        { ageMin: 65, ageMax: 999,validityYears: 1, categories: ["C", "C+E", "D", "D+E"] },
      ],
    },
  });
  console.log("✓ Product:", carnetCD.name);

  // ─── Workflow rules ───────────────────────────────────────────
  await prisma.workflowRule.upsert({
    where: { id: "00000000-0000-0000-0000-000000000005" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000005",
      tenantId: demoTenant.id,
      productId: carnetB.id,
      daysBeforeExpiry: 90,
      actionType: "WHATSAPP",
      templateName: "medirenova_renewal_reminder",
      retryEveryDays: 15,
      maxRetries: 3,
    },
  });
  console.log("✓ Workflow rule: 90 días Carnet B");

  // ─── Generate API key for demo tenant ─────────────────────────
  const rawKey = `sk_live_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const prefix = rawKey.substring(0, 16);

  const existingKey = await prisma.apiKey.findFirst({
    where: { tenantId: demoTenant.id, name: "Demo API Key" },
  });

  if (!existingKey) {
    await prisma.apiKey.create({
      data: {
        tenantId: demoTenant.id,
        name: "Demo API Key",
        keyHash,
        prefix,
      },
    });
    console.log("✓ API Key created (save this, shown only once):", rawKey);
  } else {
    console.log("✓ API Key already exists (prefix):", existingKey.prefix);
  }

  console.log("\n🎉 Seed complete!");
  console.log("─────────────────────────────────────────");
  console.log("Superadmin: admin@medirenova.es / Admin1234!");
  console.log("Demo admin: admin@clinica-demo.es / Admin1234!");
  console.log("Demo doctor: doctor@clinica-demo.es / Admin1234!");
  console.log("─────────────────────────────────────────");
  console.log("✓ Passwords hashed with bcrypt (cost 12)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
