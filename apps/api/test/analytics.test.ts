import { describe, it, expect } from "vitest";
import {
  funnelFrom, offeredSlots, occupancyFrom, saturationFrom, doctorRowsFrom, volumeFrom,
  bucketKey, rangeDays, eachDate, toCsv,
  type RoomInfo, type RevInput,
} from "../src/lib/analytics";
import { filtersSchema } from "../src/routes/analytics";

// Helpers
const sc = (status: string, n: number) => ({ status, _count: { _all: n } });
const cc = (cancelReason: string | null, n: number) => ({ cancelReason, _count: { _all: n } });
const allDays = (slots: string[]): Record<string, string[]> =>
  Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), slots]));
const room = (id: string, slots: string[], holidays: string[] = []): RoomInfo =>
  ({ id, name: id, centerId: "c1", centerName: "Centro", slotsByDay: allDays(slots), holidays: new Set(holidays) });

describe("funnelFrom — embudo + fugas (tarea 4.1)", () => {
  const byStatus = [sc("PENDING", 10), sc("CONFIRMED", 8), sc("ATTENDED", 6), sc("NO_SHOW", 2), sc("RESCHEDULED", 3), sc("CANCELLED", 5)];
  const byCancel = [cc("CLIENTE", 2), cc("CENTRO", 1), cc("DUPLICADA", 1), cc("ERROR", 1)];
  const r = funnelFrom(byStatus, byCancel, 4, 7);

  it("excluye el ruido DUPLICADA/ERROR de reservas y lo reporta aparte", () => {
    expect(r.ruido).toBe(2);
    expect(r.reservas).toBe(34 - 2); // total 34 menos ruido
  });
  it("separa cancelaciones por motivo (cliente vs centro)", () => {
    expect(r.fugas.canceladasCliente).toBe(2);
    expect(r.fugas.canceladasCentro).toBe(1);
    expect(r.fugas.canceladasOtras).toBe(0);
  });
  it("cuenta las reprogramaciones una sola vez (RESCHEDULED)", () => {
    expect(r.fugas.reprogramadas).toBe(3);
  });
  it("toma 'se fue' de las visitas LEFT y las visitas completadas de su recuento", () => {
    expect(r.fugas.seFue).toBe(7);
    expect(r.visitasCompletadas).toBe(4);
  });
  it("calcula confirmadas (=confirmadas+atendidas) y las tasas", () => {
    expect(r.confirmadas).toBe(14);
    expect(r.atendidas).toBe(6);
    expect(r.tasas.confirmacion).toBe(43.8); // 14/32
    expect(r.tasas.atencion).toBe(42.9); // 6/14
    expect(r.tasas.cancelacion).toBe(9.4); // 3/32
  });
  it("no divide por cero con periodo vacío", () => {
    const z = funnelFrom([], [], 0, 0);
    expect(z.reservas).toBe(0);
    expect(z.tasas).toEqual({ confirmacion: 0, atencion: 0, noShow: 0, cancelacion: 0 });
  });
});

describe("offeredSlots / occupancyFrom — ocupación (tarea 4.2)", () => {
  it("un festivo del centro no ofrece slots", () => {
    const r = room("A", ["09:00", "10:00"], ["2026-07-16"]);
    expect(offeredSlots(r, "2026-07-16")).toBe(0); // festivo
    expect(offeredSlots(r, "2026-07-15")).toBe(2); // laborable
  });
  it("una sala sin horario ese día no ofrece slots", () => {
    const r: RoomInfo = { id: "A", name: "A", centerId: "c1", centerName: "C", slotsByDay: {}, holidays: new Set() };
    expect(offeredSlots(r, "2026-07-15")).toBe(0);
  });
  it("ocupación = usados/disponibles y ordena por ocupación desc", () => {
    const rooms = [room("A", ["09:00", "10:00"]), room("B", ["09:00"])];
    const dates = ["2026-07-13", "2026-07-14"]; // 2 días
    const used = new Map([["A", 2], ["B", 2]]);
    const res = occupancyFrom(rooms, dates, used);
    expect(res.salas[0]!.roomId).toBe("B"); // 100% primero
    expect(res.salas[0]!.ocupacion).toBe(100); // 2/2
    expect(res.salas[1]!.ocupacion).toBe(50); // 2/4
    expect(res.total).toEqual({ disponibles: 6, usados: 4, ocupacion: 66.7 });
  });
});

describe("saturationFrom — saturación (tarea 4.3)", () => {
  const dates = ["2026-07-13", "2026-07-14", "2026-07-15"];
  const cap = new Map([["2026-07-13", 10], ["2026-07-14", 10], ["2026-07-15", 10]]);
  const dem = new Map([["2026-07-13", 9], ["2026-07-14", 10], ["2026-07-15", 2]]);

  it("marca saturado cuando demanda/capacidad ≥ umbral (0.9)", () => {
    const r = saturationFrom(dates, cap, dem, "day");
    expect(r.find((b) => b.bucket === "2026-07-13")!.saturado).toBe(true); // 90%
    expect(r.find((b) => b.bucket === "2026-07-14")!.saturado).toBe(true); // 100%
    expect(r.find((b) => b.bucket === "2026-07-15")!.saturado).toBe(false); // 20%
  });
  it("agrega por granularidad (mes → un bucket con la suma)", () => {
    const r = saturationFrom(dates, cap, dem, "month");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ bucket: "2026-07", demanda: 21, capacidad: 30, saturado: false });
  });
  it("capacidad 0 no divide por cero (saturación 0, no saturado)", () => {
    const r = saturationFrom(["2026-07-13"], new Map([["2026-07-13", 0]]), new Map([["2026-07-13", 5]]), "day");
    expect(r[0]).toMatchObject({ saturacion: 0, saturado: false });
  });
});

describe("doctorRowsFrom — rendimiento por médico (tarea 4.4)", () => {
  const d = (h: number, m: number) => new Date(`2026-07-13T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
  const revs: RevInput[] = [
    { doctorId: "d1", customerId: "p1", outcome: "APTO", startedAt: d(9, 0), completedAt: d(9, 15) }, // 15 min
    { doctorId: "d1", customerId: "p2", outcome: "APTO", startedAt: d(10, 0), completedAt: d(10, 25) }, // 25 min
    { doctorId: "d1", customerId: "p1", outcome: "NO_APTO", startedAt: null, completedAt: null }, // sin tiempos
    { doctorId: "d3", customerId: "p3", outcome: "APTO", startedAt: d(11, 0), completedAt: d(11, 10) },
  ];
  const nameOf = new Map([["d1", "Dra. Uno"], ["d2", "Dr. Dos"], ["d3", "Admin X"]]);
  const rows = doctorRowsFrom(["d1", "d2"], revs, nameOf);

  it("agrega visitas, pacientes distintos, aptitud y tiempo medio", () => {
    const r1 = rows.find((r) => r.doctorId === "d1")!;
    expect(r1).toMatchObject({ doctorName: "Dra. Uno", visitasAtendidas: 3, pacientesDistintos: 2, apto: 2, noApto: 1, tasaAptitud: 66.7, tiempoMedioMin: 20 });
  });
  it("médico sin actividad → ceros y aptitud null (sin división por cero)", () => {
    const r2 = rows.find((r) => r.doctorId === "d2")!;
    expect(r2).toMatchObject({ visitasAtendidas: 0, tasaAptitud: null, tiempoMedioMin: null });
  });
  it("resuelve el nombre de cualquier firmante (ADMIN incluido), sin UUID crudo", () => {
    const r3 = rows.find((r) => r.doctorId === "d3")!;
    expect(r3.doctorName).toBe("Admin X");
    expect(r3.visitasAtendidas).toBe(1);
  });
  it("ordena por visitas atendidas desc", () => {
    expect(rows.map((r) => r.doctorId)).toEqual(["d1", "d3", "d2"]);
  });
});

describe("volumeFrom / bucketKey / rangeDays — series y buckets", () => {
  it("volumeFrom suma reservas y visitas por bucket", () => {
    const r = volumeFrom(["2026-06-10", "2026-07-01", "2026-07-20"], ["2026-07-05"], "month");
    expect(r).toEqual([
      { bucket: "2026-06", reservas: 1, visitas: 0 },
      { bucket: "2026-07", reservas: 2, visitas: 1 },
    ]);
  });
  it("bucketKey por mes/año/día", () => {
    expect(bucketKey("2026-07-15", "month")).toBe("2026-07");
    expect(bucketKey("2026-07-15", "year")).toBe("2026");
    expect(bucketKey("2026-07-15", "day")).toBe("2026-07-15");
  });
  it("bucketKey por semana devuelve un lunes", () => {
    const monday = bucketKey("2026-07-15", "week");
    expect(new Date(`${monday}T12:00:00.000Z`).getUTCDay()).toBe(1); // 1 = lunes
  });
  it("rangeDays es inclusivo", () => {
    expect(rangeDays("2026-07-01", "2026-07-01")).toBe(1);
    expect(rangeDays("2026-07-01", "2026-07-31")).toBe(31);
  });
  it("eachDate enumera el rango inclusivo", () => {
    expect(eachDate("2026-07-01", "2026-07-03")).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });
});

describe("filtersSchema — validación de filtros (tarea 4.6)", () => {
  it("acepta un rango válido con filtros combinados", () => {
    const r = filtersSchema.safeParse({ from: "2026-07-01", to: "2026-07-31", centerId: "00000000-0000-0000-0000-000000000001", doctorId: "00000000-0000-0000-0000-000000000002" });
    expect(r.success).toBe(true);
  });
  it("rechaza rango invertido (from > to)", () => {
    expect(filtersSchema.safeParse({ from: "2026-07-31", to: "2026-07-01" }).success).toBe(false);
  });
  it("rechaza fecha con formato inválido y falta de rango", () => {
    expect(filtersSchema.safeParse({ from: "31/07/2026", to: "2026-07-01" }).success).toBe(false);
    expect(filtersSchema.safeParse({ to: "2026-07-01" }).success).toBe(false);
  });
  it("rechaza scope no soportado y uuid inválido", () => {
    expect(filtersSchema.safeParse({ from: "2026-07-01", to: "2026-07-31", scope: "half" }).success).toBe(false);
    expect(filtersSchema.safeParse({ from: "2026-07-01", to: "2026-07-31", centerId: "no-uuid" }).success).toBe(false);
  });
});

describe("toCsv — exportación (tarea 4.7)", () => {
  it("vacío → cadena vacía", () => {
    expect(toCsv([])).toBe("");
  });
  it("cabeceras + filas", () => {
    expect(toCsv([{ a: 1, b: "x" }, { a: 2, b: "y" }])).toBe("a,b\n1,x\n2,y");
  });
  it("escapa comas, comillas y saltos; null → vacío; objeto → JSON", () => {
    const csv = toCsv([{ a: "con,coma", b: 'con"comilla', c: null, d: { x: 1 } }]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("a,b,c,d");
    expect(lines[1]).toBe('"con,coma","con""comilla",,"{""x"":1}"');
  });
});
