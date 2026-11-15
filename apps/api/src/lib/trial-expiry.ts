// Vencimiento de las pruebas Pro (crm-planes P5.1). Cron diario a las 07:30:
//  - a 7 y a 1 días del fin de la prueba: email al/los ADMIN de la clínica y a los
//    superadmin del proveedor (empresa "system"), y entrada de auditoría
//    `tenant_plan` con `event: "TRIAL_NOTICE"` que además sirve de marca para no
//    repetir el aviso.
//  - al vencer (ya ha pasado la fecha y aún no hay marca): entrada de auditoría
//    `event: "TRIAL_EXPIRED"`, vaciado de la caché del plan y email a ambos.
// La vuelta a Esencial es automática (`effectivePlan` compara la fecha); aquí no
// se toca `trialUntil`, que queda como histórico. Solo cuenta para empresas con
// plan contratado Esencial: si ya son Pro, el fin de la prueba no cambia nada.
// Nunca lanza por un email fallido: se registra y se sigue con la siguiente.
import { prisma } from "./prisma.js";
import { email } from "./email.js";
import { invalidatePlanCache } from "./authorization.js";
import { PUBLIC_URL } from "./messaging/links.js";

const DAY_MS = 86_400_000;
export const NOTICE_DAYS = [7, 1] as const;

export interface TrialExpiryResult {
  notices: number;
  expired: number;
  emails: number;
  /** Lo que se haría (o se ha hecho), por empresa. */
  actions: { tenant: string; kind: "notice" | "expired"; daysLeft: number; to: string[] }[];
}

// Días que quedan, con el mismo criterio que la web (`trialDaysLeft`): techo de
// los milisegundos restantes; ≤ 0 = vencida.
export function daysLeft(trialUntil: Date, now: Date): number {
  return Math.ceil((trialUntil.getTime() - now.getTime()) / DAY_MS);
}

async function alreadyLogged(tenantId: string, event: string, trialUntil: string, days?: number): Promise<boolean> {
  const n = await prisma.auditLog.count({
    where: {
      tenantId, resourceType: "tenant_plan",
      AND: [
        { meta: { path: ["event"], equals: event } },
        { meta: { path: ["trialUntil"], equals: trialUntil } },
        ...(days != null ? [{ meta: { path: ["daysLeft"], equals: days } }] : []),
      ],
    },
  });
  return n > 0;
}

async function recipients(tenantId: string): Promise<{ admins: string[]; provider: string[] }> {
  const [admins, system] = await Promise.all([
    prisma.user.findMany({ where: { tenantId, active: true, role: "ADMIN" }, select: { email: true } }),
    prisma.tenant.findUnique({ where: { slug: "system" }, select: { users: { where: { role: "SUPERADMIN", active: true }, select: { email: true } } } }),
  ]);
  return { admins: admins.map((u) => u.email), provider: (system?.users ?? []).map((u) => u.email) };
}

const fmtDay = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });

function noticeTexts(tenantName: string, days: number, until: Date) {
  const when = days === 1 ? "mañana" : `en ${days} días`;
  return {
    admin: {
      subject: `Tu prueba del plan Pro termina ${when} · MediRenova`,
      body: `Hola,\n\nLa prueba del plan Pro de ${tenantName} termina ${when} (${fmtDay(until)}). A partir de entonces la clínica vuelve al plan Esencial: Analítica, Captación, Campañas y Workflow dejarán de estar disponibles y los avisos automáticos a pacientes quedarán en modo manual. Tus datos no se tocan.\n\nSi quieres seguir en Pro, pídelo desde Configuración → Empresa → "Tu plan" (botón "Quedarme en Pro") y te lo activamos sin interrupción:\n${PUBLIC_URL}/settings?tab=empresa\n\nMediRenova`,
    },
    provider: {
      subject: `Prueba Pro de ${tenantName} termina ${when}`,
      body: `La prueba del plan Pro de ${tenantName} termina ${when} (${fmtDay(until)}). Si no hay petición de paso a Pro, volverá a Esencial automáticamente.\n\nPanel de proveedor: ${PUBLIC_URL}/superadmin/empresas`,
    },
  };
}

function expiredTexts(tenantName: string, until: Date) {
  return {
    admin: {
      subject: `Tu prueba del plan Pro ha terminado · MediRenova`,
      body: `Hola,\n\nLa prueba del plan Pro de ${tenantName} terminó el ${fmtDay(until)} y la clínica está ya en el plan Esencial. Analítica, Captación, Campañas y Workflow quedan bloqueados y los avisos a pacientes pasan a modo manual; todos tus datos se conservan y vuelven a verse si pasas a Pro.\n\nPuedes pedir el paso a Pro cuando quieras desde Configuración → Empresa → "Tu plan":\n${PUBLIC_URL}/settings?tab=empresa\n\nMediRenova`,
    },
    provider: {
      subject: `Prueba Pro de ${tenantName} terminada → Esencial`,
      body: `La prueba del plan Pro de ${tenantName} terminó el ${fmtDay(until)}; la empresa está en Esencial.\n\nPanel de proveedor: ${PUBLIC_URL}/superadmin/empresas`,
    },
  };
}

export async function runTrialExpiry(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<TrialExpiryResult> {
  const result: TrialExpiryResult = { notices: 0, expired: 0, emails: 0, actions: [] };
  const tenants = await prisma.tenant.findMany({
    where: { plan: "ESSENTIAL", trialUntil: { not: null }, slug: { not: "system" } },
    select: { id: true, name: true, trialUntil: true },
  });

  for (const t of tenants) {
    const until = t.trialUntil!;
    const untilIso = until.toISOString();
    const left = daysLeft(until, now);

    const send = async (to: string[], subject: string, body: string) => {
      for (const addr of to) {
        if (opts.dryRun) { result.emails++; continue; }
        try { await email.sendEmail({ to: addr, subject, body }); result.emails++; }
        catch (err) { console.error(`[trial-expiry] email a ${addr} falló:`, err); }
      }
    };

    if (left > 0) {
      const days = NOTICE_DAYS.find((d) => d === left);
      if (days == null) continue;
      if (await alreadyLogged(t.id, "TRIAL_NOTICE", untilIso, days)) continue;
      const { admins, provider } = await recipients(t.id);
      const texts = noticeTexts(t.name, days, until);
      result.actions.push({ tenant: t.name, kind: "notice", daysLeft: days, to: [...admins, ...provider] });
      result.notices++;
      if (opts.dryRun) { result.emails += admins.length + provider.length; continue; }
      await send(admins, texts.admin.subject, texts.admin.body);
      await send(provider, texts.provider.subject, texts.provider.body);
      await prisma.auditLog.create({
        data: { tenantId: t.id, userId: null, action: "UPDATE", resourceType: "tenant_plan", resourceId: t.id,
          meta: { event: "TRIAL_NOTICE", daysLeft: days, trialUntil: untilIso, admins, provider } },
      }).catch((err) => console.error("[trial-expiry] auditoría del aviso falló:", err));
      continue;
    }

    // Vencida: una sola vez por fecha de prueba.
    if (await alreadyLogged(t.id, "TRIAL_EXPIRED", untilIso)) continue;
    const { admins, provider } = await recipients(t.id);
    const texts = expiredTexts(t.name, until);
    result.actions.push({ tenant: t.name, kind: "expired", daysLeft: left, to: [...admins, ...provider] });
    result.expired++;
    if (opts.dryRun) { result.emails += admins.length + provider.length; continue; }
    invalidatePlanCache(t.id);
    await prisma.auditLog.create({
      data: { tenantId: t.id, userId: null, action: "UPDATE", resourceType: "tenant_plan", resourceId: t.id,
        meta: { event: "TRIAL_EXPIRED", trialUntil: untilIso, before: { plan: "ESSENTIAL", trialUntil: untilIso }, after: { plan: "ESSENTIAL", trialUntil: untilIso }, reason: "Fin de la prueba Pro (automático)", admins, provider } },
    }).catch((err) => console.error("[trial-expiry] auditoría del vencimiento falló:", err));
    await send(admins, texts.admin.subject, texts.admin.body);
    await send(provider, texts.provider.subject, texts.provider.body);
  }
  return result;
}
