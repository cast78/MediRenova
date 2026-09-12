// Pruebas de la capa API de captación (tareas 3.1 y 3.2 de crm-captacion).
// No hay harness de integración HTTP en el proyecto (todos los tests son unitarios
// y no hay BD de test — el .env apunta a Neon), así que se cubre lo mismo probando
// las piezas puras que gobiernan el endpoint: el guard de rol, la resolución de
// alcance por tenant y la serialización CSV (misma forma de filas que las rutas).
import { describe, it, expect } from "vitest";
import { requireRole } from "../src/lib/authorization";
import { resolveScope } from "../src/routes/analytics";
import {
  toCsv, campaignEffectivenessFrom, acquisitionFrom,
  type EffCampaign, type EffRecipient, type EffAppointment,
} from "../src/lib/analytics";

const d = (s: string) => new Date(`${s}T09:00:00.000Z`);

// Ejecuta un preHandler de Fastify con un ctx dado y captura el status HTTP
// (status 0 = el guard no respondió → dejó pasar la request).
function runGuard(guard: (req: unknown, reply: unknown) => Promise<unknown>, ctx: unknown) {
  const captured: { status: number; body: unknown } = { status: 0, body: undefined };
  const reply = {
    status(code: number) { captured.status = code; return reply; },
    send(body: unknown) { captured.body = body; return reply; },
  };
  return guard({ ctx }, reply).then(() => captured);
}

// ── Tarea 3.1: alcance por rol ───────────────────────────────────────────────
describe("requireRole('ADMIN') — acceso por rol a la analítica/captación", () => {
  const guard = requireRole("ADMIN");
  it("ADMIN pasa", async () => {
    expect((await runGuard(guard, { role: "ADMIN", tenantId: "t1" })).status).toBe(0);
  });
  it("SUPERADMIN pasa", async () => {
    expect((await runGuard(guard, { role: "SUPERADMIN", tenantId: "t1" })).status).toBe(0);
  });
  it("DOCTOR → 403", async () => {
    const c = await runGuard(guard, { role: "DOCTOR", tenantId: "t1" });
    expect(c.status).toBe(403);
    expect((c.body as { errors: { code: string }[] }).errors[0]!.code).toBe("FORBIDDEN");
  });
  it("RECEPTIONIST → 403", async () => {
    expect((await runGuard(guard, { role: "RECEPTIONIST", tenantId: "t1" })).status).toBe(403);
  });
  it("sin autenticar → 401", async () => {
    expect((await runGuard(guard, undefined)).status).toBe(401);
  });
});

describe("resolveScope — aislamiento por tenant", () => {
  const q = (extra: Record<string, unknown> = {}) => ({ from: "2026-01-01", to: "2026-03-31", ...extra });
  it("ADMIN queda acotado exclusivamente a su tenant", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await resolveScope({ ctx: { role: "ADMIN", tenantId: "tA" } } as any, q() as any);
    expect(s).toEqual({ tenantWhere: { tenantId: "tA" }, tenantIds: ["tA"], isSuperadminAll: false });
  });
  it("SUPERADMIN sin scope explícito usa su propio contexto (no cross-tenant)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await resolveScope({ ctx: { role: "SUPERADMIN", tenantId: "tS" } } as any, q() as any);
    expect(s.isSuperadminAll).toBe(false);
    expect(s.tenantIds).toEqual(["tS"]);
  });
  it("SUPERADMIN con tenantId explícito acota a ese tenant", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await resolveScope({ ctx: { role: "SUPERADMIN", tenantId: "tS" } } as any, q({ tenantId: "tX" }) as any);
    expect(s.tenantIds).toEqual(["tX"]);
    expect(s.isSuperadminAll).toBe(false);
  });
});

// ── Tarea 3.2: consistencia JSON ↔ CSV ───────────────────────────────────────
describe("efectividad de campañas: el CSV refleja el mismo JSON (tarea 3.2)", () => {
  const campaigns: EffCampaign[] = [{ id: "c1", name: "Renovaciones Junio", sentAt: d("2026-06-01") }];
  const recipients: EffRecipient[] = [
    { campaignId: "c1", customerId: "u1" },
    { campaignId: "c1", customerId: "u2" },
  ];
  const appts: EffAppointment[] = [{ customerId: "u1", createdAt: d("2026-06-05"), completedVisit: true }];

  it("cabecera y valores del CSV coinciden con las filas del JSON", () => {
    const json = campaignEffectivenessFrom(campaigns, recipients, appts, 30);
    // Mismo mapeo que la ruta: las filas del CSV son el propio array de resultados.
    const csv = toCsv(json as unknown as Record<string, unknown>[]);
    const lines = csv.split("\n");
    const header = lines[0]!;
    for (const col of ["campaignId", "name", "enviados", "convertidos", "tasaConversion", "reservasAtribuidas", "visitasAtribuidas"]) {
      expect(header).toContain(col);
    }
    const row = json[0]!;
    expect(lines.length - 1).toBe(json.length); // 1 cabecera + N filas
    const cells = lines[1]!.split(",");
    expect(cells).toContain(row.name);
    expect(cells).toContain(String(row.enviados));
    expect(cells).toContain(String(row.convertidos));
    expect(cells).toContain(String(row.tasaConversion));
    expect(cells).toContain(String(row.visitasAtribuidas));
  });

  it("ventana personalizada: 3 días excluye una conversión a 5 días (coherente en JSON y CSV)", () => {
    const wide = campaignEffectivenessFrom(campaigns, recipients, appts, 30);
    const narrow = campaignEffectivenessFrom(campaigns, recipients, appts, 3);
    expect(wide[0]!.convertidos).toBe(1);
    expect(narrow[0]!.convertidos).toBe(0);
    // El CSV de la ventana estrecha refleja 0 convertidos.
    expect(toCsv(narrow as unknown as Record<string, unknown>[]).split("\n")[1]!.split(",")).toContain("0");
  });
});

describe("altas: el CSV aplana bucket + total + canales igual que la ruta (tarea 3.2)", () => {
  it("las columnas de canal aparecen como cabeceras del CSV", () => {
    const series = acquisitionFrom([
      { createdAt: d("2026-06-05"), firstApptSource: "BACKOFFICE" },
      { createdAt: d("2026-06-20"), firstApptSource: "MAGIC_LINK" },
    ], "month");
    // Mismo mapeo que la ruta /analytics/acquisition.
    const rows = series.map((b) => ({ bucket: b.bucket, total: b.total, ...b.canales }));
    const header = toCsv(rows).split("\n")[0]!;
    for (const col of ["bucket", "total", "BACKOFFICE", "MAGIC_LINK"]) {
      expect(header).toContain(col);
    }
  });
});
