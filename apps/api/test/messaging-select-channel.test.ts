import { describe, it, expect } from "vitest";
import { selectChannel, describeAttempts } from "../src/lib/messaging/select-channel.js";

const ALL = { WHATSAPP: true, SMS: true, EMAIL: true };
const contact = { phone: "612345678", email: "ana@example.com" };

describe("selectChannel", () => {
  it("elige el primer canal preferido con consentimiento y medio", () => {
    const r = selectChannel({ prefer: ["WHATSAPP", "SMS", "EMAIL"], consent: { whatsapp: true, sms: true, email: true }, contact, available: ALL });
    expect(r.channel).toBe("WHATSAPP");
    if (r.channel) expect(r.to).toBe("612345678");
  });

  it("salta al siguiente canal si falta consentimiento", () => {
    const r = selectChannel({ prefer: ["WHATSAPP", "SMS", "EMAIL"], consent: { whatsapp: false, sms: false, email: true }, contact, available: ALL });
    expect(r.channel).toBe("EMAIL");
    expect(r.tried.map((t) => t.channel)).toEqual(["WHATSAPP", "SMS"]);
  });

  it("salta si falta el medio de contacto aunque haya consentimiento", () => {
    const r = selectChannel({ prefer: ["WHATSAPP", "EMAIL"], consent: { whatsapp: true, sms: true, email: true }, contact: { phone: null, email: "ana@example.com" }, available: ALL });
    expect(r.channel).toBe("EMAIL");
    expect(r.tried[0]?.reason).toBe("sin teléfono en la ficha");
  });

  it("un email sin @ no cuenta como medio", () => {
    const r = selectChannel({ prefer: ["EMAIL"], consent: { whatsapp: true, sms: true, email: true }, contact: { phone: null, email: "sin-arroba" }, available: ALL });
    expect(r.channel).toBeNull();
  });

  it("sin ningún canal posible devuelve null con el motivo de cada intento", () => {
    const r = selectChannel({ prefer: ["WHATSAPP", "SMS"], consent: { whatsapp: false, sms: true, email: true }, contact: { phone: null, email: null }, available: ALL });
    expect(r.channel).toBeNull();
    if (!r.channel) expect(r.reason).toBe("WhatsApp: sin teléfono en la ficha · SMS: sin teléfono en la ficha");
  });

  it("un canal no disponible se descarta antes de mirar consentimiento", () => {
    const r = selectChannel({ prefer: ["SMS", "EMAIL"], consent: { whatsapp: true, sms: true, email: true }, contact, available: { ...ALL, SMS: false } });
    expect(r.channel).toBe("EMAIL");
    expect(r.tried[0]?.reason).toBe("canal no disponible");
  });

  it("los mensajes de servicio ignoran el consentimiento pero no el medio", () => {
    const ok = selectChannel({ prefer: ["EMAIL"], consent: { whatsapp: false, sms: false, email: false }, contact, available: ALL, service: true });
    expect(ok.channel).toBe("EMAIL");
    const ko = selectChannel({ prefer: ["EMAIL"], consent: { whatsapp: false, sms: false, email: false }, contact: { phone: null, email: null }, available: ALL, service: true });
    expect(ko.channel).toBeNull();
  });
});

describe("describeAttempts", () => {
  it("resume los intentos en una frase legible", () => {
    expect(describeAttempts([{ channel: "WHATSAPP", reason: "sin consentimiento" }, { channel: "EMAIL", reason: "sin email en la ficha" }]))
      .toBe("WhatsApp: sin consentimiento · Email: sin email en la ficha");
    expect(describeAttempts([])).toBe("sin canales que probar");
  });
});
