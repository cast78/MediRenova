// Librería de agregación de la API de analítica (capacidad crm-analitica).
// FUENTE ÚNICA de los KPIs de gestión: todo consumidor (dashboard interno, CSV,
// API Key externa) obtiene los mismos valores desde aquí.
//
// Arquitectura: cada métrica se parte en (1) una función `compute*` que hace las
// consultas Prisma (alcance/filtros) y (2) un NÚCLEO PURO `*From` que calcula a
// partir de filas ya cargadas. Los núcleos son puros y testeables sin BD (ver
// test/analytics.test.ts); las definiciones de cada métrica están en el design.md.
//
// Convención temporal: los instantes se guardan como "wall-clock naïve" en Z
// (`${fecha}T${hora}:00.000Z`), así que la fecha UTC del timestamp ES el día
// natural del centro. Por eso se bucketiza con getUTC* y se acotan rangos con
// límites UTC del día.
import { prisma } from "./prisma.js";
import type { Prisma } from "@prisma/client";

// ── Tipos de alcance y filtros ───────────────────────────────────────────────

export type TenantWhere = { tenantId: string } | { tenantId: { in: string[] } };

export interface AnalyticsScope {
  tenantWhere: TenantWhere;
  tenantIds: string[];
  isSuperadminAll: boolean;
}

export interface AnalyticsFilters {
  from: string; to: string;
  centerId?: string | null; roomId?: string | null; doctorId?: string | null; productId?: string | null;
}

export const MAX_RANGE_DAYS = 731; // ~2 años, tope de protección de la BD

// ── Utilidades de fecha (wall-clock en Z) — puras ────────────────────────────

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999Z`);
const weekdayOf = (d: string) => new Date(`${d}T12:00:00.000Z`).getUTCDay(); // 0=Dom … 6=Sáb

export function rangeDays(from: string, to: string): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000) + 1;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = dayStart(to).getTime();
  for (let t = dayStart(from).getTime(); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type Granularity = "day" | "week" | "month" | "year";

export function bucketKey(dateStr: string, g: Granularity): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (g === "year") return `${y}`;
  if (g === "month") return `${y}-${m}`;
  if (g === "day") return dateStr;
  const monday = new Date(d);
  const offset = (d.getUTCDay() + 6) % 7; // 0=lunes
  monday.setUTCDate(d.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

// ── Builders de `where` a partir de alcance + filtros ────────────────────────

type WhereObj = Record<string, unknown>;

function apptScopeWhere(scope: AnalyticsScope, f: AnalyticsFilters): WhereObj {
  const w: WhereObj = { ...scope.tenantWhere };
  if (f.roomId) w["roomId"] = f.roomId;
  if (f.doctorId) w["doctorId"] = f.doctorId;
  if (f.productId) w["productId"] = f.productId;
  if (f.centerId) w["room"] = { centerId: f.centerId };
  return w;
}

function visitScopeWhere(scope: AnalyticsScope, f: AnalyticsFilters): WhereObj {
  const w: WhereObj = { ...scope.tenantWhere };
  if (f.centerId) w["centerId"] = f.centerId;
  const appt: WhereObj = {};
  if (f.roomId) appt["roomId"] = f.roomId;
  if (f.doctorId) appt["doctorId"] = f.doctorId;
  if (f.productId) appt["productId"] = f.productId;
  if (Object.keys(appt).length) w["appointment"] = appt;
  return w;
}

function revisionScopeWhere(scope: AnalyticsScope, f: AnalyticsFilters): WhereObj {
  const w: WhereObj = { ...scope.tenantWhere };
  if (f.roomId) w["roomId"] = f.roomId;
  if (f.doctorId) w["doctorId"] = f.doctorId;
  if (f.productId) w["productId"] = f.productId;
  if (f.centerId) w["appointment"] = { room: { centerId: f.centerId } };
  return w;
}

// ── 1. Embudo de conversión + fugas ──────────────────────────────────────────

export interface FunnelResult {
  reservas: number; confirmadas: number; atendidas: number; visitasCompletadas: number;
  fugas: { canceladasCliente: number; canceladasCentro: number; canceladasOtras: number; reprogramadas: number; noShow: number; seFue: number };
  ruido: number;
  // Episodios cerrados administrativamente (CLOSED_ADMIN): "sin resolver", aislados
  // de las tasas clínicas pero visibles. `completadasFueraDePlazo` = revisiones
  // completadas en un día posterior al de la cita (closedLate).
  sinResolver: number;
  completadasFueraDePlazo: number;
  tasas: { confirmacion: number; atencion: number; noShow: number; cancelacion: number };
}

export interface StatusCount { status: string; _count: { _all: number } }
export interface CancelCount { cancelReason: string | null; _count: { _all: number } }

// NÚCLEO PURO: calcula el embudo a partir de los recuentos por estado/motivo.
export function funnelFrom(byStatus: StatusCount[], byCancelReason: CancelCount[], visitsCompleted: number, visitsLeft: number, closedLate = 0): FunnelResult {
  const cnt = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const cancel = (r: string | null) => byCancelReason.find((x) => x.cancelReason === r)?._count._all ?? 0;

  const attended = cnt("ATTENDED");
  const noShow = cnt("NO_SHOW");
  const rescheduled = cnt("RESCHEDULED");
  const closedAdmin = cnt("CLOSED_ADMIN"); // cierres administrativos: fuera de las tasas
  const canceladasCliente = cancel("CLIENTE");
  const canceladasCentro = cancel("CENTRO");
  const canceladasOtras = cancel("OTRO") + cancel(null);
  const ruido = cancel("DUPLICADA") + cancel("ERROR"); // fuera de las tasas (ruido)

  const canceladasTotal = canceladasCliente + canceladasCentro + canceladasOtras;
  const totalRaw = byStatus.reduce((s, r) => s + r._count._all, 0);
  // Reservas reales del periodo: excluye el ruido y los cierres administrativos
  // (episodios irrecuperables / demo), que no deben ensuciar el denominador.
  const reservas = totalRaw - ruido - closedAdmin;
  const confirmadas = cnt("CONFIRMED") + attended; // confirmadas o más

  return {
    reservas, confirmadas, atendidas: attended, visitasCompletadas: visitsCompleted,
    fugas: { canceladasCliente, canceladasCentro, canceladasOtras, reprogramadas: rescheduled, noShow, seFue: visitsLeft },
    ruido,
    sinResolver: closedAdmin,
    completadasFueraDePlazo: closedLate,
    tasas: { confirmacion: rate(confirmadas, reservas), atencion: rate(attended, confirmadas), noShow: rate(noShow, reservas), cancelacion: rate(canceladasTotal, reservas) },
  };
}

export async function computeFunnel(scope: AnalyticsScope, f: AnalyticsFilters): Promise<FunnelResult> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };
  const apptW = apptScopeWhere(scope, f);
  const [byStatus, byCancelReason, visitsCompleted, visitsLeft, closedLate] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where: { ...apptW, scheduledAt: range }, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["cancelReason"], where: { ...apptW, scheduledAt: range, status: "CANCELLED" }, _count: { _all: true } }),
    prisma.visit.count({ where: { ...visitScopeWhere(scope, f), status: "COMPLETED", completedAt: range } }),
    prisma.visit.count({ where: { ...visitScopeWhere(scope, f), status: "LEFT", arrivedAt: range } }),
    prisma.revision.count({ where: { ...revisionScopeWhere(scope, f), closedLate: true, completedAt: range } }),
  ]);
  return funnelFrom(byStatus as StatusCount[], byCancelReason as CancelCount[], visitsCompleted, visitsLeft, closedLate);
}

// ── Detalle (drill-down) de las fugas del embudo ─────────────────────────────
// Lista los casos concretos detrás de cada recuento de fuga, con LOS MISMOS
// criterios (where + campo de rango) que usa `computeFunnel`, para que el detalle
// cuadre con el agregado. Ver openspec/changes/analitica-drill-down-fugas.

export type LeakType =
  | "no_show" | "cancel_cliente" | "cancel_centro" | "cancel_otras"
  | "reprogramada" | "se_fue" | "sin_resolver" | "fuera_de_plazo";

export const LEAK_TYPES: LeakType[] = [
  "no_show", "cancel_cliente", "cancel_centro", "cancel_otras",
  "reprogramada", "se_fue", "sin_resolver", "fuera_de_plazo",
];

export interface LeakCase {
  id: string;
  appointmentId: string | null; // cita para "Ver reserva" (null en walk-in "se fue")
  customerId: string | null;
  customer: string;
  date: string;            // ISO del campo de rango relevante (cita / llegada / cierre de revisión)
  product: string | null;
  room: string | null;
  center: string | null;
  note: string | null;     // dato propio del motivo (motivo de cancelación, nota del cierre admin., etc.)
}

const CANCEL_LABEL: Record<string, string> = { CLIENTE: "el cliente canceló", CENTRO: "el centro canceló", OTRO: "otro", DUPLICADA: "duplicada", ERROR: "error de registro" };

function fullName(c: { firstName: string | null; lastName: string | null } | null): string {
  if (!c) return "Sin nombre";
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
}

export async function computeFunnelLeaks(scope: AnalyticsScope, f: AnalyticsFilters, type: LeakType): Promise<LeakCase[]> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };
  const apptW = apptScopeWhere(scope, f);

  // Selección común para casos basados en cita.
  const apptSelect = {
    id: true, scheduledAt: true, cancelReason: true, adminClosureNote: true, adminClosedAt: true, adminClosedById: true,
    customer: { select: { id: true, firstName: true, lastName: true } },
    product: { select: { name: true } },
    room: { select: { name: true, center: { select: { name: true } } } },
  } satisfies Prisma.AppointmentSelect;
  type ApptLeakRow = Prisma.AppointmentGetPayload<{ select: typeof apptSelect }>;

  const fromAppt = (a: ApptLeakRow, date: Date, note: string | null): LeakCase => ({
    id: a.id, appointmentId: a.id, customerId: a.customer?.id ?? null, customer: fullName(a.customer),
    date: date.toISOString(), product: a.product?.name ?? null,
    room: a.room?.name ?? null, center: a.room?.center?.name ?? null, note,
  });

  if (type === "no_show" || type === "reprogramada") {
    const status = type === "no_show" ? "NO_SHOW" : "RESCHEDULED";
    const rows = await prisma.appointment.findMany({ where: { ...apptW, status, scheduledAt: range }, select: apptSelect, orderBy: { scheduledAt: "desc" }, take: 500 });
    return rows.map((a) => fromAppt(a, a.scheduledAt, null));
  }

  if (type === "cancel_cliente" || type === "cancel_centro" || type === "cancel_otras") {
    const reasonWhere: Prisma.AppointmentWhereInput =
      type === "cancel_cliente" ? { cancelReason: "CLIENTE" }
      : type === "cancel_centro" ? { cancelReason: "CENTRO" }
      : { OR: [{ cancelReason: "OTRO" }, { cancelReason: null }] }; // "otras" = OTRO o sin especificar
    const rows = await prisma.appointment.findMany({ where: { ...apptW, status: "CANCELLED", scheduledAt: range, ...reasonWhere }, select: apptSelect, orderBy: { scheduledAt: "desc" }, take: 500 });
    return rows.map((a) => fromAppt(a, a.scheduledAt, a.cancelReason ? (CANCEL_LABEL[a.cancelReason] ?? a.cancelReason) : "sin especificar"));
  }

  if (type === "sin_resolver") {
    const rows = await prisma.appointment.findMany({ where: { ...apptW, status: "CLOSED_ADMIN", scheduledAt: range }, select: apptSelect, orderBy: { scheduledAt: "desc" }, take: 500 });
    // Actor del cierre (adminClosedById es escalar, sin relación): lookup en lote.
    const ids = [...new Set(rows.map((a) => a.adminClosedById).filter((x): x is string => !!x))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, fullName(u)]));
    return rows.map((a) => {
      const actor = a.adminClosedById ? byId.get(a.adminClosedById) : null;
      const when = a.adminClosedAt ? a.adminClosedAt.toISOString().slice(0, 10) : null;
      const parts = [a.adminClosureNote ?? "sin nota", actor ? `por ${actor}` : null, when].filter(Boolean);
      return fromAppt(a, a.scheduledAt, parts.join(" · "));
    });
  }

  if (type === "se_fue") {
    const rows = await prisma.visit.findMany({
      where: { ...visitScopeWhere(scope, f), status: "LEFT", arrivedAt: range },
      select: {
        id: true, arrivedAt: true, cancelReason: true, appointmentId: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        appointment: { select: { scheduledAt: true, product: { select: { name: true } }, room: { select: { name: true, center: { select: { name: true } } } } } },
      },
      orderBy: { arrivedAt: "desc" }, take: 500,
    });
    return rows.map((v) => ({
      id: v.id, appointmentId: v.appointmentId, customerId: v.customer?.id ?? null, customer: fullName(v.customer),
      date: v.arrivedAt.toISOString(), product: v.appointment?.product?.name ?? null,
      room: v.appointment?.room?.name ?? null, center: v.appointment?.room?.center?.name ?? null,
      note: "se marchó sin ser atendido",
    }));
  }

  // fuera_de_plazo: revisiones completadas después del día de la cita.
  const rows = await prisma.revision.findMany({
    where: { ...revisionScopeWhere(scope, f), closedLate: true, completedAt: range },
    select: {
      id: true, completedAt: true, outcome: true, appointmentId: true,
      customer: { select: { id: true, firstName: true, lastName: true } },
      appointment: { select: { scheduledAt: true, product: { select: { name: true } }, room: { select: { name: true, center: { select: { name: true } } } } } },
    },
    orderBy: { completedAt: "desc" }, take: 500,
  });
  return rows.map((r) => ({
    id: r.id, appointmentId: r.appointmentId, customerId: r.customer?.id ?? null, customer: fullName(r.customer),
    date: (r.completedAt ?? r.appointment?.scheduledAt ?? new Date()).toISOString(),
    product: r.appointment?.product?.name ?? null,
    room: r.appointment?.room?.name ?? null, center: r.appointment?.room?.center?.name ?? null,
    note: r.appointment?.scheduledAt ? `cita ${r.appointment.scheduledAt.toISOString().slice(0, 10)} · ${r.outcome === "APTO" ? "Apto" : r.outcome === "NO_APTO" ? "No apto" : "—"}` : null,
  }));
}

// ── 2. Ocupación por sala frente a disponibilidad ────────────────────────────

export interface RoomInfo {
  id: string; name: string; centerId: string; centerName: string;
  slotsByDay: Record<string, string[]>; holidays: Set<string>;
}
export interface OccupancyRow { roomId: string; roomName: string; centerId: string; centerName: string; disponibles: number; usados: number; ocupacion: number }
export interface OccupancyResult { salas: OccupancyRow[]; total: { disponibles: number; usados: number; ocupacion: number } }

// PURO: slots ofertados por una sala en un día (0 si es festivo de su centro).
export function offeredSlots(room: RoomInfo, date: string): number {
  if (room.holidays.has(date)) return 0;
  return (room.slotsByDay[String(weekdayOf(date))] ?? []).length;
}

// NÚCLEO PURO: filas de ocupación a partir de salas, días y uso por sala.
export function occupancyFrom(rooms: RoomInfo[], dates: string[], usedByRoom: Map<string, number>): OccupancyResult {
  const salas: OccupancyRow[] = rooms.map((r) => {
    let disponibles = 0;
    for (const d of dates) disponibles += offeredSlots(r, d);
    const usados = usedByRoom.get(r.id) ?? 0;
    return { roomId: r.id, roomName: r.name, centerId: r.centerId, centerName: r.centerName, disponibles, usados, ocupacion: rate(usados, disponibles) };
  }).sort((a, b) => b.ocupacion - a.ocupacion);
  const disp = salas.reduce((s, r) => s + r.disponibles, 0);
  const us = salas.reduce((s, r) => s + r.usados, 0);
  return { salas, total: { disponibles: disp, usados: us, ocupacion: rate(us, disp) } };
}

async function loadRooms(scope: AnalyticsScope, f: AnalyticsFilters): Promise<RoomInfo[]> {
  const centerWhere: WhereObj = { ...scope.tenantWhere, active: true };
  if (f.centerId) centerWhere["id"] = f.centerId;
  const rooms = await prisma.room.findMany({
    where: { active: true, ...(f.roomId ? { id: f.roomId } : {}), center: centerWhere },
    select: { id: true, name: true, centerId: true, schedule: true, center: { select: { name: true, holidays: true } } },
  });
  return rooms.map((r) => {
    const sched = (r.schedule as { slotsByDay?: Record<string, string[]> } | null) ?? {};
    const holidays = (r.center.holidays as string[] | null) ?? [];
    return { id: r.id, name: r.name, centerId: r.centerId, centerName: r.center.name, slotsByDay: sched.slotsByDay ?? {}, holidays: new Set(holidays) };
  });
}

async function usedByRoomMap(scope: AnalyticsScope, f: AnalyticsFilters): Promise<Map<string, number>> {
  const used = await prisma.appointment.groupBy({
    by: ["roomId"],
    where: { ...apptScopeWhere(scope, f), scheduledAt: { gte: dayStart(f.from), lte: dayEnd(f.to) }, status: { notIn: ["CANCELLED", "NO_SHOW", "CLOSED_ADMIN"] } },
    _count: { _all: true },
  });
  return new Map(used.map((u) => [u.roomId, u._count._all]));
}

export async function computeOccupancy(scope: AnalyticsScope, f: AnalyticsFilters): Promise<OccupancyResult> {
  const [rooms, usedByRoom] = await Promise.all([loadRooms(scope, f), usedByRoomMap(scope, f)]);
  return occupancyFrom(rooms, eachDate(f.from, f.to), usedByRoom);
}

// ── 3. Saturación temporal (demanda vs capacidad) ────────────────────────────

export interface SaturationBucket { bucket: string; demanda: number; capacidad: number; saturacion: number; saturado: boolean }

// NÚCLEO PURO: agrega demanda/capacidad por día en buckets y marca saturados.
export function saturationFrom(dates: string[], capByDay: Map<string, number>, demByDay: Map<string, number>, granularity: Granularity, threshold = 0.9): SaturationBucket[] {
  const acc = new Map<string, { demanda: number; capacidad: number }>();
  for (const d of dates) {
    const key = bucketKey(d, granularity);
    const cur = acc.get(key) ?? { demanda: 0, capacidad: 0 };
    cur.demanda += demByDay.get(d) ?? 0;
    cur.capacidad += capByDay.get(d) ?? 0;
    acc.set(key, cur);
  }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, v]) => ({
    bucket, demanda: v.demanda, capacidad: v.capacidad, saturacion: rate(v.demanda, v.capacidad),
    saturado: v.capacidad > 0 && v.demanda / v.capacidad >= threshold,
  }));
}

export async function computeSaturation(scope: AnalyticsScope, f: AnalyticsFilters, granularity: Granularity, threshold = 0.9): Promise<SaturationBucket[]> {
  const dates = eachDate(f.from, f.to);
  const [rooms, appts] = await Promise.all([
    loadRooms(scope, f),
    prisma.appointment.findMany({
      where: { ...apptScopeWhere(scope, f), scheduledAt: { gte: dayStart(f.from), lte: dayEnd(f.to) }, status: { notIn: ["CANCELLED", "NO_SHOW", "CLOSED_ADMIN"] } },
      select: { scheduledAt: true },
    }),
  ]);
  const capByDay = new Map<string, number>();
  for (const d of dates) { let cap = 0; for (const r of rooms) cap += offeredSlots(r, d); capByDay.set(d, cap); }
  const demByDay = new Map<string, number>();
  for (const a of appts) { const day = a.scheduledAt.toISOString().slice(0, 10); demByDay.set(day, (demByDay.get(day) ?? 0) + 1); }
  return saturationFrom(dates, capByDay, demByDay, granularity, threshold);
}

// ── 4. Rendimiento por médico ────────────────────────────────────────────────

export interface DoctorRow {
  doctorId: string; doctorName: string; visitasAtendidas: number; pacientesDistintos: number;
  apto: number; noApto: number; tasaAptitud: number | null; tiempoMedioMin: number | null;
}
export interface RevInput { doctorId: string; customerId: string; outcome: string; startedAt: Date | null; completedAt: Date | null }

// NÚCLEO PURO: agrega revisiones por médico. `ids` incluye médicos con actividad
// cero; `nameOf` resuelve el nombre de cualquier firmante (evita UUIDs crudos).
export function doctorRowsFrom(ids: string[], revs: RevInput[], nameOf: Map<string, string>): DoctorRow[] {
  interface Agg { visitas: number; pacientes: Set<string>; apto: number; noApto: number; durSum: number; durN: number }
  const byDoc = new Map<string, Agg>();
  for (const r of revs) {
    const a = byDoc.get(r.doctorId) ?? { visitas: 0, pacientes: new Set(), apto: 0, noApto: 0, durSum: 0, durN: 0 };
    a.visitas++; a.pacientes.add(r.customerId);
    if (r.outcome === "APTO") a.apto++; else if (r.outcome === "NO_APTO") a.noApto++;
    if (r.startedAt && r.completedAt) { a.durSum += (r.completedAt.getTime() - r.startedAt.getTime()) / 60_000; a.durN++; }
    byDoc.set(r.doctorId, a);
  }
  const allIds = [...new Set<string>([...ids, ...byDoc.keys()])];
  return allIds.map((id) => {
    const a = byDoc.get(id);
    const total = (a?.apto ?? 0) + (a?.noApto ?? 0);
    return {
      doctorId: id, doctorName: nameOf.get(id) ?? id,
      visitasAtendidas: a?.visitas ?? 0, pacientesDistintos: a?.pacientes.size ?? 0,
      apto: a?.apto ?? 0, noApto: a?.noApto ?? 0,
      tasaAptitud: total > 0 ? Math.round(((a!.apto) / total) * 1000) / 10 : null,
      tiempoMedioMin: a && a.durN > 0 ? Math.round((a.durSum / a.durN) * 10) / 10 : null,
    };
  }).sort((x, y) => y.visitasAtendidas - x.visitasAtendidas);
}

export async function computeDoctors(scope: AnalyticsScope, f: AnalyticsFilters): Promise<DoctorRow[]> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };
  const [doctors, revs] = await Promise.all([
    prisma.user.findMany({ where: { ...scope.tenantWhere, role: "DOCTOR" }, select: { id: true } }),
    prisma.revision.findMany({
      where: { ...revisionScopeWhere(scope, f), outcome: { in: ["APTO", "NO_APTO"] }, completedAt: range },
      select: { doctorId: true, customerId: true, outcome: true, startedAt: true, completedAt: true },
    }),
  ]);
  const ids = [...new Set<string>([...doctors.map((d) => d.id), ...revs.map((r) => r.doctorId)])];
  const signers = await prisma.user.findMany({ where: { ...scope.tenantWhere, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  const nameOf = new Map(signers.map((s) => [s.id, `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || s.id]));
  return doctorRowsFrom(doctors.map((d) => d.id), revs as RevInput[], nameOf);
}

// ── 5. Comparativa entre salas y entre centros ───────────────────────────────

export interface ComparisonRow { id: string; name: string; centerName?: string; reservas: number; atendidas: number; conversion: number; ocupacion: number }
export interface ComparisonResult { porCentro: ComparisonRow[]; porSala: ComparisonRow[] }

export async function computeComparison(scope: AnalyticsScope, f: AnalyticsFilters): Promise<ComparisonResult> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };
  const occ = await computeOccupancy(scope, f);
  const byRoomStatus = await prisma.appointment.groupBy({ by: ["roomId", "status"], where: { ...apptScopeWhere(scope, f), scheduledAt: range }, _count: { _all: true } });

  const roomAgg = new Map<string, { reservas: number; atendidas: number }>();
  for (const r of byRoomStatus) {
    const a = roomAgg.get(r.roomId) ?? { reservas: 0, atendidas: 0 };
    if (r.status !== "CANCELLED") a.reservas += r._count._all; // reservas = no canceladas
    if (r.status === "ATTENDED") a.atendidas += r._count._all;
    roomAgg.set(r.roomId, a);
  }

  const porSala: ComparisonRow[] = occ.salas.map((s) => {
    const a = roomAgg.get(s.roomId) ?? { reservas: 0, atendidas: 0 };
    return { id: s.roomId, name: s.roomName, centerName: s.centerName, reservas: a.reservas, atendidas: a.atendidas, conversion: rate(a.atendidas, a.reservas), ocupacion: s.ocupacion };
  });

  const centerMap = new Map<string, ComparisonRow>();
  const dispByCenter = new Map<string, { u: number; d: number }>();
  for (const s of occ.salas) {
    const a = roomAgg.get(s.roomId) ?? { reservas: 0, atendidas: 0 };
    const c = centerMap.get(s.centerId) ?? { id: s.centerId, name: s.centerName, reservas: 0, atendidas: 0, conversion: 0, ocupacion: 0 };
    c.reservas += a.reservas; c.atendidas += a.atendidas; centerMap.set(s.centerId, c);
    const x = dispByCenter.get(s.centerId) ?? { u: 0, d: 0 };
    x.u += s.usados; x.d += s.disponibles; dispByCenter.set(s.centerId, x);
  }
  const porCentro = [...centerMap.values()].map((c) => {
    const x = dispByCenter.get(c.id) ?? { u: 0, d: 0 };
    return { ...c, conversion: rate(c.atendidas, c.reservas), ocupacion: rate(x.u, x.d) };
  }).sort((a, b) => b.reservas - a.reservas);

  return { porCentro, porSala };
}

// ── 6. Series de volumen (visitas y reservas) ────────────────────────────────

export interface VolumeBucket { bucket: string; reservas: number; visitas: number }

// NÚCLEO PURO: bucketiza reservas (por scheduledAt) y visitas (por completedAt).
export function volumeFrom(apptDates: string[], visitDates: string[], granularity: Granularity): VolumeBucket[] {
  const acc = new Map<string, { reservas: number; visitas: number }>();
  for (const d of apptDates) { const k = bucketKey(d, granularity); const c = acc.get(k) ?? { reservas: 0, visitas: 0 }; c.reservas++; acc.set(k, c); }
  for (const d of visitDates) { const k = bucketKey(d, granularity); const c = acc.get(k) ?? { reservas: 0, visitas: 0 }; c.visitas++; acc.set(k, c); }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, v]) => ({ bucket, reservas: v.reservas, visitas: v.visitas }));
}

export async function computeVolume(scope: AnalyticsScope, f: AnalyticsFilters, granularity: Granularity): Promise<VolumeBucket[]> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };
  const [appts, visits] = await Promise.all([
    prisma.appointment.findMany({ where: { ...apptScopeWhere(scope, f), scheduledAt: range, status: { notIn: ["CANCELLED", "CLOSED_ADMIN"] } }, select: { scheduledAt: true } }),
    prisma.visit.findMany({ where: { ...visitScopeWhere(scope, f), status: "COMPLETED", completedAt: range }, select: { completedAt: true } }),
  ]);
  return volumeFrom(
    appts.map((a) => a.scheduledAt.toISOString().slice(0, 10)),
    visits.filter((v) => v.completedAt).map((v) => v.completedAt!.toISOString().slice(0, 10)),
    granularity,
  );
}

// ── CAPTACIÓN (crm-captacion, fase 1 — solo lectura) ─────────────────────────

// 7. Altas de clientes por periodo y canal (proxy: source de la 1ª cita).
export interface AcquisitionCustomer { createdAt: Date; firstApptSource: string | null }
export interface AcquisitionBucket { bucket: string; total: number; canales: Record<string, number> }

// NÚCLEO PURO: agrupa altas por bucket y desglosa por canal ("SIN_CITA" si no tiene cita).
export function acquisitionFrom(customers: AcquisitionCustomer[], granularity: Granularity): AcquisitionBucket[] {
  const acc = new Map<string, { total: number; canales: Record<string, number> }>();
  for (const c of customers) {
    const key = bucketKey(c.createdAt.toISOString().slice(0, 10), granularity);
    const cur = acc.get(key) ?? { total: 0, canales: {} };
    cur.total++;
    const canal = c.firstApptSource ?? "SIN_CITA";
    cur.canales[canal] = (cur.canales[canal] ?? 0) + 1;
    acc.set(key, cur);
  }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, v]) => ({ bucket, total: v.total, canales: v.canales }));
}

// 8. Clientes nuevos vs recurrentes entre los activos del periodo.
export interface CustomerTenure { firstApptDate: string | null } // YYYY-MM-DD de su 1ª cita histórica

// NÚCLEO PURO: nuevo = 1ª cita dentro del rango; recurrente = ya tenía cita antes.
export function newVsReturningFrom(active: CustomerTenure[], from: string, to: string): { nuevos: number; recurrentes: number } {
  let nuevos = 0, recurrentes = 0;
  for (const c of active) {
    if (!c.firstApptDate) continue;
    if (c.firstApptDate < from) recurrentes++;
    else if (c.firstApptDate <= to) nuevos++;
  }
  return { nuevos, recurrentes };
}

// 9. Efectividad de campañas (crm-captacion). Atribución STORED (fase 2): usa el
// `convertedAt` sellado al reservar (última campaña antes de la cita), aplicando en
// LECTURA la ventana pedida. Para destinatarios sin `convertedAt` (histórico previo al
// backfill) cae al FALLBACK heurístico por ventana (last-touch), sin recontar los pares
// (campaña, cliente) ni las citas ya contados por la vía stored.
export interface EffCampaign { id: string; name: string; sentAt: Date | null }
export interface EffRecipient { campaignId: string; customerId: string; convertedAt: Date | null; convertedAppointmentId: string | null }
export interface EffAppointment { id: string; customerId: string; createdAt: Date; completedVisit: boolean }
export interface CampaignEffRow { campaignId: string; name: string; enviados: number; convertidos: number; tasaConversion: number; reservasAtribuidas: number; visitasAtribuidas: number }

export function campaignEffectivenessFrom(campaigns: EffCampaign[], recipients: EffRecipient[], appointments: EffAppointment[], windowDays: number): CampaignEffRow[] {
  const windowMs = windowDays * 86_400_000;
  const campById = new Map<string, { name: string; sentAt: Date }>();
  for (const c of campaigns) if (c.sentAt) campById.set(c.id, { name: c.name, sentAt: c.sentAt });

  const apptById = new Map<string, EffAppointment>();
  for (const a of appointments) apptById.set(a.id, a);

  const enviados = new Map<string, number>();
  const sentToCustomer = new Map<string, { campaignId: string; sentAt: Date }[]>();
  interface Agg { reservas: number; visitas: number; convertidos: Set<string> }
  const byCamp = new Map<string, Agg>();
  const agg = (id: string): Agg => {
    let a = byCamp.get(id);
    if (!a) { a = { reservas: 0, visitas: 0, convertidos: new Set() }; byCamp.set(id, a); }
    return a;
  };
  const claimedAppts = new Set<string>();  // citas ya atribuidas por la vía stored
  const storedPair = new Set<string>();    // `${campaignId}|${customerId}` ya convertidos por stored

  // 1) Envíos + conversiones STORED (convertedAt dentro de la ventana pedida).
  for (const r of recipients) {
    const camp = campById.get(r.campaignId);
    if (!camp) continue;
    enviados.set(r.campaignId, (enviados.get(r.campaignId) ?? 0) + 1);
    const arr = sentToCustomer.get(r.customerId) ?? [];
    arr.push({ campaignId: r.campaignId, sentAt: camp.sentAt });
    sentToCustomer.set(r.customerId, arr);

    if (r.convertedAt) {
      const sentMs = camp.sentAt.getTime(), convMs = r.convertedAt.getTime();
      if (sentMs <= convMs && convMs - sentMs <= windowMs) {
        const a = agg(r.campaignId);
        a.convertidos.add(r.customerId);
        a.reservas++;
        storedPair.add(`${r.campaignId}|${r.customerId}`);
        if (r.convertedAppointmentId) {
          claimedAppts.add(r.convertedAppointmentId);
          if (apptById.get(r.convertedAppointmentId)?.completedVisit) a.visitas++;
        }
      }
    }
  }

  // 2) FALLBACK heurístico para lo no sellado: cada cita no reclamada se atribuye a la
  // campaña last-touch dentro de ventana, salvo pares ya contados por stored.
  for (const appt of appointments) {
    if (claimedAppts.has(appt.id)) continue;
    const sent = sentToCustomer.get(appt.customerId);
    if (!sent) continue;
    const t = appt.createdAt.getTime();
    let best: { campaignId: string; sentMs: number } | null = null;
    for (const s of sent) {
      const sm = s.sentAt.getTime();
      if (sm <= t && t - sm <= windowMs && (!best || sm > best.sentMs)) best = { campaignId: s.campaignId, sentMs: sm };
    }
    if (!best) continue;
    if (storedPair.has(`${best.campaignId}|${appt.customerId}`)) continue;
    const a = agg(best.campaignId);
    a.convertidos.add(appt.customerId);
    a.reservas++;
    if (appt.completedVisit) a.visitas++;
  }

  return [...campById.entries()].map(([id, c]) => {
    const a = byCamp.get(id);
    const env = enviados.get(id) ?? 0;
    const conv = a?.convertidos.size ?? 0;
    return { campaignId: id, name: c.name, enviados: env, convertidos: conv, tasaConversion: rate(conv, env), reservasAtribuidas: a?.reservas ?? 0, visitasAtribuidas: a?.visitas ?? 0 };
  }).sort((x, y) => y.convertidos - x.convertidos);
}

// Consultas Prisma que alimentan los núcleos de captación (solo lectura).

export interface AcquisitionResult { series: AcquisitionBucket[]; nuevosVsRecurrentes: { nuevos: number; recurrentes: number } }

export async function computeAcquisition(scope: AnalyticsScope, f: AnalyticsFilters, granularity: Granularity): Promise<AcquisitionResult> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };

  // Altas del periodo + canal (source de su 1ª cita histórica).
  const created = await prisma.customer.findMany({ where: { ...scope.tenantWhere, deletedAt: null, createdAt: range }, select: { id: true, createdAt: true } });
  const createdIds = created.map((c) => c.id);
  const sourceByCustomer = new Map<string, string>();
  if (createdIds.length) {
    const appts = await prisma.appointment.findMany({ where: { ...scope.tenantWhere, customerId: { in: createdIds } }, select: { customerId: true, source: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } });
    for (const a of appts) if (!sourceByCustomer.has(a.customerId)) sourceByCustomer.set(a.customerId, a.source);
  }
  const series = acquisitionFrom(created.map((c) => ({ createdAt: c.createdAt, firstApptSource: sourceByCustomer.get(c.id) ?? null })), granularity);

  // Nuevos vs recurrentes entre los clientes activos (con cita en el rango).
  const activeAppts = await prisma.appointment.findMany({ where: { ...scope.tenantWhere, scheduledAt: range }, select: { customerId: true } });
  const activeIds = [...new Set(activeAppts.map((a) => a.customerId))];
  const tenure: CustomerTenure[] = [];
  if (activeIds.length) {
    const firstEver = await prisma.appointment.findMany({ where: { ...scope.tenantWhere, customerId: { in: activeIds } }, select: { customerId: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } });
    const firstDate = new Map<string, string>();
    for (const a of firstEver) if (!firstDate.has(a.customerId)) firstDate.set(a.customerId, a.scheduledAt.toISOString().slice(0, 10));
    for (const id of activeIds) tenure.push({ firstApptDate: firstDate.get(id) ?? null });
  }
  return { series, nuevosVsRecurrentes: newVsReturningFrom(tenure, f.from, f.to) };
}

export async function computeCampaignEffectiveness(scope: AnalyticsScope, f: AnalyticsFilters, windowDays: number): Promise<CampaignEffRow[]> {
  const range = { gte: dayStart(f.from), lte: dayEnd(f.to) };
  const campaigns = await prisma.campaign.findMany({ where: { ...scope.tenantWhere, sentAt: range }, select: { id: true, name: true, sentAt: true } });
  if (campaigns.length === 0) return [];
  const campIds = campaigns.map((c) => c.id);
  const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: { in: campIds }, status: "SENT" }, select: { campaignId: true, customerId: true, convertedAt: true, convertedAppointmentId: true } });
  const custIds = [...new Set(recipients.map((r) => r.customerId))];

  // Citas de esos clientes en la ventana global [primer envío, último envío + N días].
  const sentTimes = campaigns.map((c) => c.sentAt!.getTime());
  const minSent = new Date(Math.min(...sentTimes));
  const maxSentPlusWindow = new Date(Math.max(...sentTimes) + windowDays * 86_400_000);
  const appts = custIds.length
    ? await prisma.appointment.findMany({
        where: { ...scope.tenantWhere, customerId: { in: custIds }, createdAt: { gte: minSent, lte: maxSentPlusWindow } },
        select: { id: true, customerId: true, createdAt: true, visit: { select: { status: true } } },
      })
    : [];
  const effAppts: EffAppointment[] = appts.map((a) => ({ id: a.id, customerId: a.customerId, createdAt: a.createdAt, completedVisit: a.visit?.status === "COMPLETED" }));
  return campaignEffectivenessFrom(campaigns as EffCampaign[], recipients, effAppts, windowDays);
}

// ── Serialización CSV (para format=csv) — pura ───────────────────────────────

function flatten(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const flat = rows.map(flatten);
  const headers = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [headers.join(",")];
  for (const r of flat) lines.push(headers.map((h) => esc(r[h] ?? "")).join(","));
  return lines.join("\n");
}
