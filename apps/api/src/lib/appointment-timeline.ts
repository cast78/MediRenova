// Construye los eventos de trazabilidad de UNA cita (reserva → visita → revisión +
// acciones registradas). Compartido por la ficha del cliente (agrega por cita) y por
// el timeline de la reserva. El caller ordena por fecha.

export interface TimelineEvent { at: string; kind: string; title: string; detail: string; tone: string }

export interface ApptForTimeline {
  id: string;
  scheduledAt: Date; status: string; source: string | null; cancelReason: string | null; createdAt: Date; updatedAt: Date;
  product: { name: string } | null;
  room: { name: string } | null; // sala reservada
  visit: { arrivedAt: Date; calledAt: Date | null; startedAt: Date | null; status: string; updatedAt: Date; currentRoom: { name: string } | null } | null;
  revision: { outcome: string; completedAt: Date | null; expiryDate: Date | null; startedAt: Date | null } | null;
}
export interface CustEv { type: string; channel: string | null; detail: string | null; createdAt: Date; appointmentId?: string | null }

const SOURCE: Record<string, string> = { WALK_IN: "walk-in", MAGIC_LINK: "reserva online", API: "API" };
const CANCEL: Record<string, string> = { CLIENTE: "el cliente canceló", CENTRO: "el centro canceló", DUPLICADA: "duplicada", ERROR: "error de registro", OTRO: "otro" };
const CHAN: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", SMS: "SMS", LINK: "Enlace copiado" };
const CE: Record<string, { title: string; tone: string }> = {
  confirmacion_solicitada: { title: "Confirmación solicitada", tone: "comm" },
  cliente_confirmo: { title: "El cliente confirmó la cita", tone: "confirm" },
  cliente_cancelo: { title: "El cliente indicó que no podrá ir", tone: "negative" },
  cita_cancelada: { title: "Cita cancelada", tone: "negative" },
  no_show: { title: "No se presentó", tone: "negative" },
  recordatorio_renovacion: { title: "Recordatorio de renovación enviado", tone: "comm" },
};

// Mapea eventos registrados (CustomerEvent) a eventos de timeline. Compartido para
// los de una cita concreta y los de nivel cliente (p. ej. recordatorio de renovación).
export function mapCustomerEvents(events: CustEv[]): TimelineEvent[] {
  return events.map((e) => {
    const m = CE[e.type] ?? { title: e.type, tone: "book" };
    let detail = e.detail ?? "";
    if (e.type === "cita_cancelada") detail = e.detail ? CANCEL[e.detail] ?? e.detail : "por recepción";
    else if (e.type === "no_show") detail = "por recepción";
    else if (e.type === "recordatorio_renovacion") detail = [e.channel ? (CHAN[e.channel] ?? e.channel) : null, e.detail].filter(Boolean).join(" · ");
    else if (!detail && e.channel) detail = CHAN[e.channel] ?? e.channel;
    return { at: iso(e.createdAt), kind: e.type, title: m.title, detail, tone: m.tone };
  });
}

const iso = (d: Date) => d.toISOString();
const naiveWhen = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export function appointmentEvents(a: ApptForTimeline, custEvents: CustEv[]): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const prod = a.product?.name ?? "";
  // ¿La cancelación/no-show ya tiene evento explícito? → no usar el derivado (impreciso).
  const hasTerminalEvent = custEvents.some((e) => e.type === "cita_cancelada" || e.type === "no_show" || e.type === "cliente_cancelo");

  ev.push({ at: iso(a.createdAt), kind: "reserva", title: "Reserva creada", detail: `${prod} · ${naiveWhen(a.scheduledAt)}${a.source && a.source !== "BACKOFFICE" ? ` · ${SOURCE[a.source] ?? a.source}` : ""}`, tone: "book" });
  if (a.status === "CANCELLED" && !hasTerminalEvent) ev.push({ at: iso(a.updatedAt), kind: "cancelada", title: "Cita cancelada", detail: a.cancelReason ? CANCEL[a.cancelReason] ?? a.cancelReason : prod, tone: "negative" });
  // Si se fue (visita LEFT), el "Se fue del centro" (abajo) cubre el matiz → no se
  // duplica con "No se presentó" aunque la reserva esté en NO_SHOW.
  if (a.status === "NO_SHOW" && !hasTerminalEvent && a.visit?.status !== "LEFT") ev.push({ at: iso(a.updatedAt), kind: "no_show", title: "No se presentó", detail: prod, tone: "negative" });
  if (a.status === "RESCHEDULED") ev.push({ at: iso(a.updatedAt), kind: "reprogramada", title: "Cita reprogramada", detail: prod, tone: "reprog" });
  if (a.visit?.arrivedAt) ev.push({ at: iso(a.visit.arrivedAt), kind: "llegada", title: "Llegó al centro", detail: "Check-in", tone: "arrive" });
  if (a.visit?.calledAt) {
    // Registra la sala REAL a la que pasó; si difiere de la reservada, lo señala.
    const actual = a.visit.currentRoom?.name;
    const booked = a.room?.name;
    const detail = actual ? (booked && booked !== actual ? `${actual} · reservó ${booked}` : actual) : prod;
    ev.push({ at: iso(a.visit.calledAt), kind: "en_sala", title: "Pasó a sala", detail, tone: "arrive" });
  }
  if (a.visit?.status === "LEFT") ev.push({ at: iso(a.visit.updatedAt), kind: "se_fue", title: "Se fue del centro", detail: "Sin ser atendido", tone: "negative" });
  if (a.revision?.startedAt && !a.revision.completedAt) ev.push({ at: iso(a.revision.startedAt), kind: "revision_ini", title: "Revisión iniciada", detail: prod, tone: "clinic" });
  if (a.revision?.completedAt) {
    const out = a.revision.outcome === "APTO" ? "Apto" : a.revision.outcome === "NO_APTO" ? "No apto" : "";
    ev.push({ at: iso(a.revision.completedAt), kind: "revision", title: `Revisión completada · ${out}`, detail: `${prod}${a.revision.expiryDate ? ` · caduca ${a.revision.expiryDate.toISOString().slice(0, 10)}` : ""}`, tone: "clinic" });
  }
  ev.push(...mapCustomerEvents(custEvents));
  return ev;
}
