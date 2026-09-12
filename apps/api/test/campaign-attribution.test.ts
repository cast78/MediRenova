// Fase 2 de crm-captacion: atribución persistida campaña→visita.
import { describe, it, expect } from "vitest";
import { pickCampaignConversion, MAX_ATTRIBUTION_WINDOW_DAYS } from "../src/lib/campaign-attribution";
import { campaignEffectivenessFrom, type EffCampaign, type EffRecipient, type EffAppointment } from "../src/lib/analytics";

const d = (s: string) => new Date(`${s}T09:00:00.000Z`);

describe("pickCampaignConversion — destinatario a convertir (last-touch en ventana)", () => {
  it("elige el envío más reciente anterior a la cita", () => {
    const cands = [
      { recipientId: "rA", sentAt: d("2026-06-01") },
      { recipientId: "rB", sentAt: d("2026-06-20") },
    ];
    expect(pickCampaignConversion(cands, d("2026-06-25"))).toBe("rB");
  });
  it("ignora envíos posteriores a la cita", () => {
    expect(pickCampaignConversion([{ recipientId: "rA", sentAt: d("2026-07-01") }], d("2026-06-25"))).toBeNull();
  });
  it("ignora envíos fuera de la ventana máxima", () => {
    expect(pickCampaignConversion([{ recipientId: "rA", sentAt: d("2026-01-01") }], d("2026-06-25"), 30)).toBeNull();
  });
  it("sin candidatos → null", () => {
    expect(pickCampaignConversion([], d("2026-06-25"))).toBeNull();
  });
  it("ventana máxima por defecto = 90 días", () => {
    expect(MAX_ATTRIBUTION_WINDOW_DAYS).toBe(90);
  });
});

describe("campaignEffectivenessFrom — atribución STORED (fase 2)", () => {
  const campaigns: EffCampaign[] = [{ id: "c1", name: "Renovación", sentAt: d("2026-06-01") }];

  it("cuenta la conversión sellada (convertedAt en ventana) y su visita", () => {
    const recipients: EffRecipient[] = [
      { campaignId: "c1", customerId: "u1", convertedAt: d("2026-06-05"), convertedAppointmentId: "a1" },
      { campaignId: "c1", customerId: "u2", convertedAt: null, convertedAppointmentId: null },
    ];
    const appts: EffAppointment[] = [{ id: "a1", customerId: "u1", createdAt: d("2026-06-05"), completedVisit: true }];
    const [row] = campaignEffectivenessFrom(campaigns, recipients, appts, 30);
    expect(row).toMatchObject({ enviados: 2, convertidos: 1, reservasAtribuidas: 1, visitasAtribuidas: 1, tasaConversion: 50 });
  });

  it("la ventana pedida se aplica en lectura sobre convertedAt", () => {
    const recipients: EffRecipient[] = [
      { campaignId: "c1", customerId: "u1", convertedAt: d("2026-06-05"), convertedAppointmentId: "a1" },
    ];
    const appts: EffAppointment[] = [{ id: "a1", customerId: "u1", createdAt: d("2026-06-05"), completedVisit: true }];
    expect(campaignEffectivenessFrom(campaigns, recipients, appts, 3)[0]!.convertidos).toBe(0); // 4 días > 3
    expect(campaignEffectivenessFrom(campaigns, recipients, appts, 30)[0]!.convertidos).toBe(1);
  });

  it("convertido aunque la cita se cancele; visita sólo si se completó", () => {
    const recipients: EffRecipient[] = [
      { campaignId: "c1", customerId: "u1", convertedAt: d("2026-06-05"), convertedAppointmentId: "a1" },
    ];
    const appts: EffAppointment[] = [{ id: "a1", customerId: "u1", createdAt: d("2026-06-05"), completedVisit: false }]; // cancelada / no-show
    expect(campaignEffectivenessFrom(campaigns, recipients, appts, 30)[0]).toMatchObject({ convertidos: 1, visitasAtribuidas: 0 });
  });

  it("no recuenta por fallback un par (campaña,cliente) ya sellado", () => {
    const recipients: EffRecipient[] = [
      { campaignId: "c1", customerId: "u1", convertedAt: d("2026-06-05"), convertedAppointmentId: "a1" },
    ];
    const appts: EffAppointment[] = [
      { id: "a1", customerId: "u1", createdAt: d("2026-06-05"), completedVisit: true }, // sellada
      { id: "a2", customerId: "u1", createdAt: d("2026-06-10"), completedVisit: true }, // otra cita del mismo → no re-cuenta
    ];
    expect(campaignEffectivenessFrom(campaigns, recipients, appts, 30)[0]!.convertidos).toBe(1);
  });

  it("mezcla stored + fallback: uno sellado y otro sólo heurístico", () => {
    const recipients: EffRecipient[] = [
      { campaignId: "c1", customerId: "u1", convertedAt: d("2026-06-05"), convertedAppointmentId: "a1" }, // stored
      { campaignId: "c1", customerId: "u2", convertedAt: null, convertedAppointmentId: null }, // fallback
    ];
    const appts: EffAppointment[] = [
      { id: "a1", customerId: "u1", createdAt: d("2026-06-05"), completedVisit: true },
      { id: "a2", customerId: "u2", createdAt: d("2026-06-08"), completedVisit: false }, // heurístico → c1
    ];
    expect(campaignEffectivenessFrom(campaigns, recipients, appts, 30)[0]).toMatchObject({ convertidos: 2, reservasAtribuidas: 2 });
  });
});
