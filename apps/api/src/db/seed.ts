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
      cif: "B12345674",
      address: "Calle Serrano 45",
      city: "Madrid",
      province: "Madrid",
      postalCode: "28001",
      phones: ["+34 91 123 45 67", "+34 600 11 22 33"],
      emails: ["madrid@clinica-demo.es", "citas@clinica-demo.es"],
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
      allowedProductIds: [],
      // Huecos explícitos por día (0=Dom … 6=Sáb): lunes a viernes 09:00–13:30 cada 30 min.
      schedule: {
        slotsByDay: {
          "1": ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"],
          "2": ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"],
          "3": ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"],
          "4": ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"],
          "5": ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"],
        },
      },
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
  // Carnet Grupo 1 (A/B/B+E): 10 años hasta los 65, 5 años a partir de 65 (DGT).
  const carnetBRules = {
    requiresMedical: true,
    requiresPsych: true,
    requiresVision: false,
    ageRules: [
      { minAge: 0,  maxAge: 17,  validityDays: 0 },
      { minAge: 18, maxAge: 65,  validityDays: 3650 },
      { minAge: 66, maxAge: 120, validityDays: 1825 },
    ],
  };
  const carnetB = await prisma.product.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: { renewalRules: carnetBRules },
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      tenantId: demoTenant.id,
      name: "Carnet de Conducir (A/B/B+E)",
      type: "CARNET_CONDUCIR",
      slotDuration: 20,
      renewalRules: carnetBRules,
    },
  });
  console.log("✓ Product:", carnetB.name);

  // ─── Demo Product: Carnet C/D ─────────────────────────────────
  // Carnet Grupo 2 (C/D): 5 años hasta los 65, 3 años a partir de 65 (DGT).
  const carnetCDRules = {
    requiresMedical: true,
    requiresPsych: true,
    requiresVision: true,
    ageRules: [
      { minAge: 0,  maxAge: 17,  validityDays: 0 },
      { minAge: 18, maxAge: 65,  validityDays: 1825 },
      { minAge: 66, maxAge: 120, validityDays: 1095 },
    ],
  };
  const carnetCD = await prisma.product.upsert({
    where: { id: "00000000-0000-0000-0000-000000000004" },
    update: { renewalRules: carnetCDRules },
    create: {
      id: "00000000-0000-0000-0000-000000000004",
      tenantId: demoTenant.id,
      name: "Carnet de Conducir (C/D)",
      type: "CARNET_CONDUCIR",
      slotDuration: 30,
      renewalRules: carnetCDRules,
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
