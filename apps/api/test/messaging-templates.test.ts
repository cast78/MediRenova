import { describe, it, expect } from "vitest";
import { renderMessage, appointmentVars, EVENT_PREFER, EVENT_SERVICE, EVENT_LABELS } from "../src/lib/messaging/templates.js";

const vars = { nombre: "Ana", clinica: "Clínica Demo", producto: "Carnet de conducir", fecha: "15/10/2026", hora: "09:20", centro: "Madrid Centro", sala: " (Sala 1)", caduca: "02/11/2026", enlace: "https://x/b/abc" };

describe("renderMessage", () => {
  it("rellena las variables y da CTA + plantilla de Meta en WhatsApp", () => {
    const t = renderMessage("appointment_created", "WHATSAPP", vars);
    expect(t.body).toContain("Hola Ana, tu cita de Carnet de conducir es el 15/10/2026 a las 09:20 en Madrid Centro (Sala 1)");
    expect(t.cta).toBe("Confirmar cita");
    expect(t.templateName).toBe("medirenova_confirmacion_cita");
    expect(t.subject).toBeUndefined();
  });

  it("el SMS lleva el enlace dentro del texto", () => {
    const t = renderMessage("noshow_invite", "SMS", vars);
    expect(t.body).toContain("https://x/b/abc");
    expect(t.body.startsWith("Clínica Demo:")).toBe(true);
  });

  it("el email tiene asunto renderizado y CTA", () => {
    const t = renderMessage("portal_access", "EMAIL", vars);
    expect(t.subject).toBe("Acceso a tu área de paciente · Clínica Demo");
    expect(t.cta).toBe("Entrar en mi área");
  });

  it("las variables que faltan quedan vacías, no como {{clave}}", () => {
    const t = renderMessage("renewal_reminder", "WHATSAPP", { nombre: "Ana" });
    expect(t.body).not.toContain("{{");
  });

  it("cada evento tiene etiqueta y orden de canales; el portal prefiere email y es de servicio", () => {
    for (const ev of Object.keys(EVENT_LABELS) as (keyof typeof EVENT_LABELS)[]) {
      expect(EVENT_PREFER[ev].length).toBe(3);
    }
    expect(EVENT_PREFER.portal_access[0]).toBe("EMAIL");
    expect(EVENT_SERVICE.has("portal_access")).toBe(true);
    expect(EVENT_SERVICE.has("appointment_created")).toBe(false);
  });
});

describe("appointmentVars", () => {
  it("formatea la fecha naive cortando el ISO (sin desplazar zona horaria)", () => {
    const v = appointmentVars({ scheduledAt: new Date("2026-10-15T09:20:00.000Z"), product: { name: "Carnet" }, room: { name: "Sala 1", center: { name: "Madrid" } } });
    expect(v).toEqual({ producto: "Carnet", fecha: "15/10/2026", hora: "09:20", centro: "Madrid", sala: " (Sala 1)" });
  });
  it("sin sala ni producto deja los campos vacíos", () => {
    const v = appointmentVars({ scheduledAt: new Date("2026-01-02T08:00:00.000Z") });
    expect(v.sala).toBe("");
    expect(v.producto).toBe("");
  });
});
