// Clasificación de episodios sin cerrar (núcleo puro, sin BD).
import { describe, it, expect } from "vitest";
import { classifyStuckEpisode, episodeAgeDays, isClosedLate, STUCK_LABELS } from "../src/lib/episodes";
import { episodeDigest, type OpenEpisode } from "../src/lib/episode-alerts";

describe("classifyStuckEpisode — detección de episodio atascado", () => {
  it("sin visita → null (es no-show/cancelar en la worklist de reservas)", () => {
    expect(classifyStuckEpisode(null, null)).toBeNull();
    expect(classifyStuckEpisode(undefined, undefined)).toBeNull();
  });

  it("visita en espera sin revisión → 'espero'", () => {
    expect(classifyStuckEpisode({ status: "WAITING" }, null)).toBe("espero");
  });

  it("visita en sala sin revisión → 'en_sala'", () => {
    expect(classifyStuckEpisode({ status: "IN_PROGRESS" }, null)).toBe("en_sala");
  });

  it("revisión iniciada sin completar → 'revision_a_medias' (manda sobre el estado de la visita)", () => {
    expect(classifyStuckEpisode({ status: "IN_PROGRESS" }, { completedAt: null })).toBe("revision_a_medias");
    expect(classifyStuckEpisode({ status: "WAITING" }, { completedAt: null })).toBe("revision_a_medias");
  });

  it("revisión completada → null (clínicamente cerrada aunque la visita no esté terminal)", () => {
    expect(classifyStuckEpisode({ status: "IN_PROGRESS" }, { completedAt: new Date("2026-09-12T10:00:00Z") })).toBeNull();
    expect(classifyStuckEpisode({ status: "IN_PROGRESS" }, { completedAt: "2026-09-12T10:00:00Z" })).toBeNull();
  });

  it("visita terminal → null (episodio resuelto)", () => {
    for (const status of ["COMPLETED", "LEFT", "CANCELLED"]) {
      expect(classifyStuckEpisode({ status }, null)).toBeNull();
      // incluso con revisión a medias, una visita terminal se considera resuelta
      expect(classifyStuckEpisode({ status }, { completedAt: null })).toBeNull();
    }
  });

  it("todas las etiquetas atascadas tienen texto legible", () => {
    expect(STUCK_LABELS.espero).toMatch(/Esperó/);
    expect(STUCK_LABELS.en_sala).toMatch(/sala/);
    expect(STUCK_LABELS.revision_a_medias).toMatch(/edias/);
  });
});

describe("episodeAgeDays — antigüedad del episodio", () => {
  const now = new Date("2026-09-13T10:00:00Z");
  it("mismo día → 0", () => {
    expect(episodeAgeDays(new Date("2026-09-13T08:00:00Z"), now)).toBe(0);
  });
  it("ayer → 1", () => {
    expect(episodeAgeDays(new Date("2026-09-12T08:00:00Z"), now)).toBe(1);
  });
  it("hace una semana → 7", () => {
    expect(episodeAgeDays(new Date("2026-09-06T10:00:00Z"), now)).toBe(7);
  });
  it("nunca negativa (cita futura)", () => {
    expect(episodeAgeDays(new Date("2026-09-20T10:00:00Z"), now)).toBe(0);
  });
});

describe("isClosedLate — revisión completada fuera de plazo", () => {
  it("completada el mismo día de la cita → no es tardía", () => {
    expect(isClosedLate(new Date("2026-09-13T09:00:00Z"), new Date("2026-09-13T18:30:00Z"))).toBe(false);
  });
  it("completada al día siguiente → tardía", () => {
    expect(isClosedLate(new Date("2026-09-12T09:00:00Z"), new Date("2026-09-13T09:05:00Z"))).toBe(true);
  });
  it("completada varios días después → tardía", () => {
    expect(isClosedLate(new Date("2026-09-06T09:00:00Z"), new Date("2026-09-13T10:00:00Z"))).toBe(true);
  });
});

describe("episodeDigest — email de aviso de fin de día", () => {
  const ep = (over: Partial<OpenEpisode>): OpenEpisode => ({
    id: "a", customerName: "Ana Ruiz", productName: "Carnet", centerName: "Madrid", doctorName: "Sol Gil", stuckLabel: "Esperó sin ser atendido", ageDays: 2, ...over,
  });

  it("asunto con recuento y pluralización", () => {
    expect(episodeDigest([ep({})]).subject).toBe("1 episodio sin cerrar");
    expect(episodeDigest([ep({}), ep({ customerName: "B" })], "Clínica Demo").subject).toBe("2 episodios sin cerrar · Clínica Demo");
  });
  it("el cuerpo lista cada episodio con sus datos", () => {
    const { body } = episodeDigest([ep({ customerName: "Ana Ruiz", ageDays: 3 })]);
    expect(body).toContain("• Ana Ruiz — Esperó sin ser atendido · Carnet · Madrid · Dr. Sol Gil · hace 3 días");
  });
  it("trunca a 30 y anota el resto", () => {
    const many = Array.from({ length: 33 }, (_, i) => ep({ id: String(i), customerName: `C${i}` }));
    const { body } = episodeDigest(many);
    expect(body).toContain("…y 3 más.");
    expect(body).toContain("C0");
    expect(body).not.toContain("C31");
  });
});
