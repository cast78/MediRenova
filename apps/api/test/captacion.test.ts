import { describe, it, expect } from "vitest";
import {
  acquisitionFrom, newVsReturningFrom, campaignEffectivenessFrom,
  type AcquisitionCustomer, type EffCampaign, type EffRecipient, type EffAppointment,
} from "../src/lib/analytics";

const d = (s: string) => new Date(`${s}T09:00:00.000Z`);

describe("acquisitionFrom — altas por periodo y canal (tarea 1.4)", () => {
  const customers: AcquisitionCustomer[] = [
    { createdAt: d("2026-06-05"), firstApptSource: "BACKOFFICE" },
    { createdAt: d("2026-06-20"), firstApptSource: "MAGIC_LINK" },
    { createdAt: d("2026-07-02"), firstApptSource: "BACKOFFICE" },
    { createdAt: d("2026-07-10"), firstApptSource: null }, // sin cita
  ];
  it("agrupa por bucket con total y desglose por canal", () => {
    const r = acquisitionFrom(customers, "month");
    expect(r).toEqual([
      { bucket: "2026-06", total: 2, canales: { BACKOFFICE: 1, MAGIC_LINK: 1 } },
      { bucket: "2026-07", total: 2, canales: { BACKOFFICE: 1, SIN_CITA: 1 } },
    ]);
  });
  it("clasifica como SIN_CITA a quien no tiene primera cita", () => {
    const r = acquisitionFrom([{ createdAt: d("2026-07-01"), firstApptSource: null }], "month");
    expect(r[0]!.canales).toEqual({ SIN_CITA: 1 });
  });
});

describe("newVsReturningFrom — nuevos vs recurrentes", () => {
  it("nuevo = 1ª cita en rango; recurrente = 1ª cita anterior; null se ignora", () => {
    const active = [
      { firstApptDate: "2026-07-05" }, // nuevo
      { firstApptDate: "2026-06-15" }, // recurrente
      { firstApptDate: "2026-07-31" }, // nuevo (== to)
      { firstApptDate: null }, // ignorado
    ];
    expect(newVsReturningFrom(active, "2026-07-01", "2026-07-31")).toEqual({ nuevos: 2, recurrentes: 1 });
  });
});

describe("campaignEffectivenessFrom — atribución por ventana (tarea 1.3)", () => {
  const campaigns: EffCampaign[] = [
    { id: "c1", name: "Camp 1", channel: "EMAIL", sentAt: d("2026-07-01") },
    { id: "c2", name: "Camp 2", channel: "WHATSAPP", sentAt: d("2026-07-10") },
    { id: "c3", name: "Sin enviar", channel: "EMAIL", sentAt: null }, // se excluye
  ];
  // Sin convertedAt → toda la atribución va por el FALLBACK heurístico (equivalente al
  // comportamiento previo a fase 2). Las conversiones STORED se prueban en campaign-attribution.test.ts.
  const recipients: EffRecipient[] = [
    { campaignId: "c1", customerId: "A", convertedAt: null, convertedAppointmentId: null },
    { campaignId: "c1", customerId: "B", convertedAt: null, convertedAppointmentId: null },
    { campaignId: "c1", customerId: "C", convertedAt: null, convertedAppointmentId: null },
    { campaignId: "c2", customerId: "A", convertedAt: null, convertedAppointmentId: null },
    { campaignId: "c3", customerId: "D", convertedAt: null, convertedAppointmentId: null },
  ];
  const appointments: EffAppointment[] = [
    { id: "a1", customerId: "A", createdAt: d("2026-07-12"), completedVisit: true }, // ventana de c1 y c2 → last-touch c2
    { id: "a2", customerId: "A", createdAt: d("2026-07-15"), completedVisit: false }, // otra vez A → c2 (no doble conteo en convertidos)
    { id: "a3", customerId: "B", createdAt: d("2026-07-05"), completedVisit: false }, // solo c1
    { id: "a4", customerId: "C", createdAt: d("2026-09-01"), completedVisit: true }, // fuera de ventana (30d) → no cuenta
  ];
  const rows = campaignEffectivenessFrom(campaigns, recipients, appointments, 30);
  const byId = (id: string) => rows.find((r) => r.campaignId === id)!;

  it("excluye campañas sin enviar (sin sentAt)", () => {
    expect(rows.map((r) => r.campaignId).sort()).toEqual(["c1", "c2"]);
  });
  it("last-touch: atribuye a la campaña más reciente dentro de la ventana", () => {
    expect(byId("c2")).toMatchObject({ enviados: 1, convertidos: 1, reservasAtribuidas: 2, visitasAtribuidas: 1, tasaConversion: 100 });
    // A no cuenta como convertido de c1 (fue last-touch a c2); C está fuera de ventana.
    expect(byId("c1")).toMatchObject({ enviados: 3, convertidos: 1, reservasAtribuidas: 1, visitasAtribuidas: 0 });
  });
  it("no cuenta dos veces al mismo cliente en 'convertidos' aunque tenga 2 citas", () => {
    expect(byId("c2").convertidos).toBe(1);
    expect(byId("c2").reservasAtribuidas).toBe(2);
  });
  it("tasa de conversión = convertidos / enviados", () => {
    expect(byId("c1").tasaConversion).toBe(33.3); // 1/3
  });
  it("una ventana estrecha excluye conversiones fuera de plazo", () => {
    const r = campaignEffectivenessFrom(campaigns, recipients, appointments, 1);
    // Con 1 día, la cita de A (07-12) queda fuera de c2 (07-10) y c1 (07-01).
    expect(r.find((x) => x.campaignId === "c2")!.convertidos).toBe(0);
  });
});
