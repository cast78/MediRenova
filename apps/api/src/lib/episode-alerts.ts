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

// Orquestación: recorre los tenants activos, busca episodios abiertos y, si hay,
// avisa por email al personal (ADMIN + RECEPCIÓN) con email válido.
export async function runEpisodeAlerts(): Promise<{ tenants: number; emails: number }> {
  const tenants = await prisma.tenant.findMany({ where: { active: true, slug: { not: "system" } }, select: { id: true, name: true } });
  const configs = await prisma.tenantConfig.findMany({ select: { tenantId: true, timezone: true } });
  const tzOf = new Map(configs.map((c) => [c.tenantId, c.timezone]));

  let tenantsNotified = 0, emailsSent = 0;
  for (const t of tenants) {
    const episodes = await findOpenEpisodes(t.id, tzOf.get(t.id) ?? "Europe/Madrid");
    if (episodes.length === 0) continue;

    const staff = await prisma.user.findMany({
      where: { tenantId: t.id, active: true, role: { in: ["ADMIN", "RECEPTIONIST"] } },
      select: { email: true },
    });
    const recipients = [...new Set(staff.map((s) => s.email).filter((e) => e && e.includes("@")))];
    if (recipients.length === 0) continue;

    const { subject, body } = episodeDigest(episodes, t.name);
    tenantsNotified++;
    for (const to of recipients) {
      try { await email.sendEmail({ to, subject, body }); emailsSent++; }
      catch (err) { console.error(`[episode-alerts] email a ${to} falló:`, err); }
    }
  }
  return { tenants: tenantsNotified, emails: emailsSent };
}
