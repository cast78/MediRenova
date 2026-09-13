// Aviso de fin de día de "episodios sin cerrar" (crm-episodios-sin-cerrar §6.1).
// Al final del día, lista los episodios abiertos de cada tenant y avisa por email
// al personal (ADMIN + RECEPCIÓN). El aviso in-app lo cubre el contador del panel.
// Reutiliza el clasificador puro classifyStuckEpisode (misma verdad que el endpoint).
import { prisma } from "./prisma.js";
import { nowInTimezone } from "./availability.js";
import { classifyStuckEpisode, episodeAgeDays, STUCK_LABELS } from "./episodes.js";
import { email } from "./email.js";

export interface OpenEpisode {
  id: string;
  customerName: string;
  productName: string | null;
  centerName: string | null;
  doctorName: string | null;
  stuckLabel: string;
  ageDays: number;
}

const name = (c: { firstName: string | null; lastName: string | null } | null): string =>
  c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre" : "Sin nombre";

// Episodios sin cerrar de UN tenant (todos sus centros): citas pasadas con visita
// no terminal o revisión a medias. `tz` = zona horaria del centro (hora de pared).
export async function findOpenEpisodes(tenantId: string, tz: string): Promise<OpenEpisode[]> {
  const nowNaive = nowInTimezone(tz);
  const todayStart = new Date(`${nowNaive.date}T00:00:00.000Z`);
  const nowRef = todayStart;

  const candidates = await prisma.appointment.findMany({
    where: {
      tenantId,
      scheduledAt: { lt: todayStart },
      OR: [
        { visit: { is: { status: { in: ["WAITING", "IN_PROGRESS"] } } } },
        { visit: { isNot: null }, revision: { is: { completedAt: null } } },
      ],
    },
    take: 500,
    select: {
      id: true, scheduledAt: true,
      customer: { select: { firstName: true, lastName: true } },
      product: { select: { name: true } },
      room: { select: { center: { select: { name: true } } } },
      doctor: { select: { firstName: true, lastName: true } },
      visit: { select: { status: true } },
      revision: { select: { completedAt: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });

  const out: OpenEpisode[] = [];
  for (const a of candidates) {
    const stuck = classifyStuckEpisode(a.visit, a.revision);
    if (!stuck) continue;
    out.push({
      id: a.id,
      customerName: name(a.customer),
      productName: a.product?.name ?? null,
      centerName: a.room?.center?.name ?? null,
      doctorName: a.doctor ? name(a.doctor) : null,
      stuckLabel: STUCK_LABELS[stuck],
      ageDays: episodeAgeDays(a.scheduledAt, nowRef),
    });
  }
  return out;
}

// NÚCLEO PURO: construye el email del digest a partir de los episodios abiertos.
export function episodeDigest(episodes: OpenEpisode[], tenantName?: string): { subject: string; body: string } {
  const n = episodes.length;
  const subject = `${n} episodio${n !== 1 ? "s" : ""} sin cerrar${tenantName ? ` · ${tenantName}` : ""}`;
  const MAX = 30;
  const lines = episodes.slice(0, MAX).map((e) => {
    const bits = [e.stuckLabel, e.productName, e.centerName, e.doctorName ? `Dr. ${e.doctorName}` : null, `hace ${e.ageDays} día${e.ageDays !== 1 ? "s" : ""}`].filter(Boolean);
    return `• ${e.customerName} — ${bits.join(" · ")}`;
  });
  const extra = n > MAX ? `\n…y ${n - MAX} más.` : "";
  const body =
    `Hay ${n} episodio${n !== 1 ? "s" : ""} de días pasados con el paciente presente pero sin cerrar.\n` +
    `Revísalos y ciérralos en Reservas → pestaña "Episodios".\n\n` +
    lines.join("\n") + extra;
  return { subject, body };
}

// Destinatarios del aviso de un tenant: personal ADMIN + RECEPCIÓN con email válido.
async function alertRecipients(tenantId: string): Promise<string[]> {
  const staff = await prisma.user.findMany({
    where: { tenantId, active: true, role: { in: ["ADMIN", "RECEPTIONIST"] } },
    select: { email: true },
  });
  return [...new Set(staff.map((s) => s.email).filter((e) => e && e.includes("@")))];
}

export interface TenantAlert { count: number; subject: string; body: string; recipients: string[]; episodes: OpenEpisode[] }

// Prepara el aviso de UN tenant (episodios + email + destinatarios) SIN enviar.
// Lo usan la vista previa y el envío bajo demanda.
export async function buildTenantAlert(tenantId: string, tz: string, tenantName?: string): Promise<TenantAlert> {
  const episodes = await findOpenEpisodes(tenantId, tz);
  const { subject, body } = episodeDigest(episodes, tenantName);
  const recipients = await alertRecipients(tenantId);
  return { count: episodes.length, subject, body, recipients, episodes };
}

// Envía el aviso de UN tenant y devuelve cuántos correos salieron.
export async function sendTenantAlert(tenantId: string, tz: string, tenantName?: string): Promise<{ count: number; recipients: string[]; subject: string; sent: number }> {
  const a = await buildTenantAlert(tenantId, tz, tenantName);
  let sent = 0;
  if (a.count > 0) {
    for (const to of a.recipients) {
      try { await email.sendEmail({ to, subject: a.subject, body: a.body }); sent++; }
      catch (err) { console.error(`[episode-alerts] email a ${to} falló:`, err); }
    }
  }
  return { count: a.count, recipients: a.recipients, subject: a.subject, sent };
}

// Orquestación (cron): recorre los tenants activos y avisa por email a su personal.
export async function runEpisodeAlerts(): Promise<{ tenants: number; emails: number }> {
  const tenants = await prisma.tenant.findMany({ where: { active: true, slug: { not: "system" } }, select: { id: true, name: true } });
  const configs = await prisma.tenantConfig.findMany({ select: { tenantId: true, timezone: true } });
  const tzOf = new Map(configs.map((c) => [c.tenantId, c.timezone]));

  let tenantsNotified = 0, emailsSent = 0;
  for (const t of tenants) {
    const r = await sendTenantAlert(t.id, tzOf.get(t.id) ?? "Europe/Madrid", t.name);
    if (r.sent > 0) { tenantsNotified++; emailsSent += r.sent; }
  }
  return { tenants: tenantsNotified, emails: emailsSent };
}
