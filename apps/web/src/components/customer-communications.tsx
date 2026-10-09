"use client";

// Comunicaciones al paciente (crm-mensajeria, Fase 0): lista de avisos que el
// sistema ha redactado para este cliente + vista previa "así lo recibe" por canal
// + detalle. En modo demo los avisos no se envían: se muestran como "Simulado".
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Mail, MessageSquare, Bot, UserCircle, ExternalLink, Copy, Check, Link2, Ban, FlaskConical } from "lucide-react";
import { apiFetch } from "@/lib/api";

export type DeliveryChannel = "WHATSAPP" | "SMS" | "EMAIL";
export type DeliveryStatus = "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED";

export interface Delivery {
  id: string;
  createdAt: string;
  sentAt: string | null;
  event: string;
  eventLabel: string;
  channel: DeliveryChannel | null;
  provider: string;
  status: DeliveryStatus;
  to: string | null;
  subject: string | null;
  body: string;
  cta: string | null;
  link: string | null;
  templateName: string | null;
  vars: Record<string, string> | null;
  reason: string | null;
  appointmentId: string | null;
  by: string | null;
  customer: { id: string; firstName: string | null; lastName: string | null };
}

export const CHANNEL_LABEL: Record<DeliveryChannel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

// Icono de canal con su color (verde WhatsApp · azul email · violeta SMS).
export function ChannelIcon({ channel, size = "md" }: { channel: DeliveryChannel | null; size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-6 h-6 rounded-md" : "w-[34px] h-[34px] rounded-[10px]";
  const ico = size === "sm" ? "w-3.5 h-3.5" : "w-[18px] h-[18px]";
  if (channel === "WHATSAPP") return <span className={`${box} bg-emerald-50 text-emerald-600 inline-flex items-center justify-center shrink-0`}><MessageCircle className={ico} /></span>;
  if (channel === "EMAIL") return <span className={`${box} bg-blue-50 text-blue-600 inline-flex items-center justify-center shrink-0`}><Mail className={ico} /></span>;
  if (channel === "SMS") return <span className={`${box} bg-violet-50 text-violet-600 inline-flex items-center justify-center shrink-0`}><MessageSquare className={ico} /></span>;
  return <span className={`${box} bg-gray-100 text-gray-400 inline-flex items-center justify-center shrink-0`}><Ban className={ico} /></span>;
}

// Chip de estado. Regla de honestidad: con proveedor "demo" se dice "Simulado",
// nunca "Entregado/Leído".
export function StatusChip({ d }: { d: Pick<Delivery, "status" | "provider"> }) {
  const base = "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap";
  if (d.status === "SKIPPED") return <span className={`${base} bg-gray-50 text-gray-500 border-gray-300 border-dashed`}>Omitido</span>;
  if (d.status === "FAILED") return <span className={`${base} bg-red-50 text-red-700 border-red-200`}>Fallido</span>;
  if (d.provider === "demo") return <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}><FlaskConical className="w-3 h-3" />Simulado</span>;
  if (d.status === "READ") return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>Leído</span>;
  if (d.status === "DELIVERED") return <span className={`${base} bg-blue-50 text-blue-700 border-blue-200`}>Entregado</span>;
  return <span className={`${base} bg-gray-100 text-gray-700 border-gray-200`}>Enviado</span>;
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Hoy, ${time}`;
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Ayer, ${time}`;
  return `${d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })}, ${time}`;
}

const EVENT_DETAIL: Record<string, string> = {
  appointment_created: "Cita creada (alta de reserva)",
  appointment_rescheduled: "Cita reprogramada",
  confirmation_requested: "Pedir confirmación (botón de Reservas)",
  noshow_invite: "Invitación a reagendar tras no-show",
  renewal_reminder: "Recordatorio de renovación (workflow)",
  portal_access: "Acceso al portal (mensaje de servicio: no requiere consentimiento de marketing)",
};

function channelDetail(d: Delivery): string {
  if (!d.channel) return "Sin canal posible";
  const base = CHANNEL_LABEL[d.channel];
  if (d.provider === "demo") return `${base} · simulado (sin proveedor configurado)`;
  if (d.channel === "WHATSAPP") return `${base} · plantilla aprobada (Meta)`;
  return base;
}

function linkNote(d: Delivery): string {
  if (!d.link) return "";
  if (d.event === "portal_access") return "· sesión de 60 min";
  return "· válido 30 días";
}

function timeline(d: Delivery): string {
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");
  if (d.status === "SKIPPED") return `Omitido ${t(d.createdAt)}`;
  if (d.status === "FAILED") return `Enviado ${t(d.createdAt)} → Fallido`;
  if (d.provider === "demo") return `Redactado ${t(d.createdAt)} · no enviado (modo demo)`;
  if (d.status === "READ") return `Enviado ${t(d.sentAt ?? d.createdAt)} → Entregado → Leído`;
  if (d.status === "DELIVERED") return `Enviado ${t(d.sentAt ?? d.createdAt)} → Entregado`;
  return `Enviado ${t(d.sentAt ?? d.createdAt)}`;
}

// ── Vista previa por canal ────────────────────────────────────────────────────

function WhatsAppPreview({ d }: { d: Delivery }) {
  const clinica = d.vars?.["clinica"] ?? "MediRenova";
  return (
    <div className="rounded-[22px] bg-gray-900 p-2.5 shadow-xl">
      <div className="rounded-2xl overflow-hidden bg-[#e5ddd5]">
        <div className="bg-[#075e54] text-white px-3.5 py-2.5 flex items-center gap-2.5">
          <span className="w-[30px] h-[30px] rounded-full bg-[#128c7e] inline-flex items-center justify-center text-[11px] font-bold">{clinica.slice(0, 2).toUpperCase()}</span>
          <span className="flex flex-col leading-tight"><span className="text-[13px] font-semibold">{clinica}</span><span className="text-[11px] opacity-80">cuenta de empresa{d.to ? ` · ${d.to}` : ""}</span></span>
        </div>
        <div className="px-3.5 pt-4 pb-5 flex flex-col gap-2 min-h-[220px]">
          <div className="self-center text-[10px] bg-white text-gray-500 px-2 py-0.5 rounded-md">{fmtWhen(d.createdAt).split(",")[0]}</div>
          <div className="bg-white rounded-[10px] rounded-tl-sm px-2.5 pt-2.5 pb-1.5 max-w-[92%] shadow-sm">
            <p className="m-0 text-[13.5px] leading-[19px] text-gray-900 whitespace-pre-line">{d.body}</p>
            <div className="text-right text-[10px] text-gray-400 mt-1">{new Date(d.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
            {d.cta && d.link && (
              <div className="border-t border-gray-200 -mx-2.5 mt-1.5 px-2.5 pt-2.5 pb-1 flex items-center justify-center gap-1.5 text-[#027eb5] text-[13.5px] font-semibold">
                <ExternalLink className="w-[15px] h-[15px]" />{d.cta}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailPreview({ d }: { d: Delivery }) {
  const clinica = d.vars?.["clinica"] ?? "MediRenova";
  const centro = d.vars?.["centro"];
  return (
    <div className="border border-gray-200 rounded-[14px] bg-white overflow-hidden shadow-lg">
      <div className="px-3.5 py-3 border-b border-gray-100 flex flex-col gap-1 text-xs text-gray-500">
        <div><b className="font-semibold text-gray-700">De:</b> {clinica} vía MediRenova</div>
        <div><b className="font-semibold text-gray-700">Para:</b> {d.to ?? "—"}</div>
        <div className="text-sm font-semibold text-gray-900 mt-0.5">{d.subject ?? d.eventLabel}</div>
      </div>
      <div className="bg-gray-100 p-4">
        <div className="bg-white rounded-xl overflow-hidden border border-gray-200 max-w-[380px] mx-auto">
          <div className="bg-blue-600 text-white px-4 py-3 font-bold text-sm flex items-center gap-2"><span className="w-[22px] h-[22px] rounded-md bg-white/20 inline-block" />{clinica}</div>
          <div className="p-4 flex flex-col gap-3">
            <p className="m-0 text-[13.5px] leading-5 text-gray-700 whitespace-pre-line">{d.body}</p>
            {d.cta && d.link && <span className="self-start bg-blue-600 text-white font-semibold text-[13px] px-4 py-2.5 rounded-[10px]">{d.cta}</span>}
            <p className="m-0 text-[11px] text-gray-400 leading-4">{clinica}{centro ? ` · ${centro}` : ""}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmsPreview({ d }: { d: Delivery }) {
  const clinica = d.vars?.["clinica"] ?? "MediRenova";
  const chars = d.body.length;
  const parts = chars <= 160 ? 1 : Math.ceil(chars / 153);
  return (
    <div className="rounded-[22px] bg-gray-900 p-2.5 shadow-xl">
      <div className="rounded-2xl overflow-hidden bg-white">
        <div className="px-3.5 py-2.5 border-b border-gray-100 flex flex-col items-center gap-0.5">
          <span className="w-[30px] h-[30px] rounded-full bg-gray-200 text-gray-700 inline-flex items-center justify-center text-[11px] font-bold">{clinica.slice(0, 2).toUpperCase()}</span>
          <span className="text-xs font-semibold text-gray-900">{clinica}</span>
        </div>
        <div className="px-3.5 py-4 flex flex-col gap-1.5 min-h-[200px]">
          <div className="self-center text-[10px] text-gray-400">{fmtWhen(d.createdAt)}</div>
          <div className="bg-[#e9e9eb] text-gray-900 rounded-[18px] rounded-bl-[4px] px-3 py-2 max-w-[88%] text-[13.5px] leading-[19px] whitespace-pre-line">{d.body}</div>
          <div className="text-[11px] text-gray-500 mt-1.5">{parts} SMS · {chars} caracteres · remitente alfanumérico</div>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function CustomerCommunications({ customerId, consent }: {
  customerId: string;
  consent?: { whatsapp: boolean; sms: boolean; email: boolean };
}) {
  const { data, isLoading } = useQuery<Delivery[]>({
    queryKey: ["customer-deliveries", customerId],
    queryFn: () => apiFetch<Delivery[]>(`/customers/${customerId}/deliveries`),
  });
  const [filter, setFilter] = useState<"ALL" | DeliveryChannel>("ALL");
  const [selId, setSelId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => (data ?? []).filter((d) => filter === "ALL" || d.channel === filter), [data, filter]);
  const sel = rows.find((d) => d.id === selId) ?? rows[0] ?? null;
  const demo = (data ?? []).some((d) => d.provider === "demo");

  async function copyText() {
    if (!sel) return;
    const text = sel.link && sel.channel !== "SMS" ? `${sel.body}\n\n${sel.cta ? `${sel.cta}: ` : ""}${sel.link}` : sel.body;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* noop */ }
  }

  const chip = (k: "ALL" | DeliveryChannel, label: string) => (
    <button key={k} type="button" onClick={() => setFilter(k)}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${filter === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {consent && (
        <div className="flex flex-wrap gap-1.5">
          {(["whatsapp", "sms", "email"] as const).map((k) => consent[k]
            ? <span key={k} className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{k === "whatsapp" ? "WhatsApp" : k === "sms" ? "SMS" : "Email"} ✓</span>
            : <span key={k} className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-dashed border-gray-300">{k === "whatsapp" ? "WhatsApp" : k === "sms" ? "SMS" : "Email"} sin consentimiento</span>)}
        </div>
      )}

      {demo && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3.5 py-2.5 text-[13px] leading-[18px]">
          <FlaskConical className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
          <div><b className="font-semibold">Modo demo:</b> los avisos no se envían al paciente; el sistema los redacta, elige el canal y los guarda aquí tal y como los recibiría. Cuando configures un canal real en Configuración → Comunicaciones, esta misma pantalla mostrará las entregas reales.</div>
        </div>
      )}

      <div className="flex flex-wrap gap-5 items-start">
        {/* Lista */}
        <section className="flex-[999_1_480px] min-w-0 space-y-2.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[15px] font-semibold text-gray-900">Avisos al paciente</h2>
            <span className="text-xs text-gray-500">{(data ?? []).length} en total</span>
            <div className="ml-auto flex gap-1.5">{chip("ALL", "Todos")}{chip("WHATSAPP", "WhatsApp")}{chip("EMAIL", "Email")}{chip("SMS", "SMS")}</div>
          </div>

          {isLoading ? (
            <p className="text-sm text-gray-400 py-6">Cargando…</p>
          ) : rows.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
              Todavía no hay avisos para este paciente. Se generan solos al crear o reprogramar una cita, pedir confirmación, invitar tras un no-show, recordar una renovación o pedir acceso al portal.
            </div>
          ) : rows.map((d) => {
            const active = sel?.id === d.id;
            return (
              <button key={d.id} type="button" onClick={() => setSelId(d.id)}
                className={`w-full text-left flex items-start gap-3 px-3.5 py-3 rounded-xl border transition-colors ${active ? "bg-blue-50 border-blue-300 ring-1 ring-inset ring-blue-300" : "bg-white border-gray-200 hover:border-blue-200"}`}>
                <ChannelIcon channel={d.channel} />
                <span className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 whitespace-nowrap">{d.eventLabel}</span>
                    <span className="text-[13px] font-semibold text-gray-900 truncate">{d.subject ?? d.body.split("\n")[0]}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 flex-wrap">
                    {d.by ? <UserCircle className="w-[13px] h-[13px] text-gray-400" /> : <Bot className="w-[13px] h-[13px] text-gray-400" />}
                    <span>{d.by ? `Recepción · ${d.by}` : "Sistema"}</span>
                    <span>·</span>
                    <span>{d.channel ? CHANNEL_LABEL[d.channel] : "sin canal"}</span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-xs text-gray-500 whitespace-nowrap">{fmtWhen(d.createdAt)}</span>
                  <StatusChip d={d} />
                </span>
              </button>
            );
          })}
        </section>

        {/* Vista previa + detalle */}
        {sel && (
          <aside className="flex-[1_1_360px] max-w-[460px] min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-gray-900">Vista previa</h2>
              <span className="text-xs text-gray-500">así lo recibe el paciente</span>
            </div>

            {sel.channel === "WHATSAPP" && <WhatsAppPreview d={sel} />}
            {sel.channel === "EMAIL" && <EmailPreview d={sel} />}
            {sel.channel === "SMS" && <SmsPreview d={sel} />}
            {sel.channel === null && (
              <div className="border border-dashed border-gray-300 rounded-xl p-4 text-sm text-gray-600 bg-gray-50">
                <p className="font-semibold text-gray-700 mb-1">Qué habría recibido</p>
                <p className="whitespace-pre-line">{sel.body}</p>
              </div>
            )}

            {(sel.status === "SKIPPED" || sel.status === "FAILED") && sel.reason && (
              <div className="flex gap-2.5 items-start rounded-xl px-3 py-2.5 text-[13px] leading-[18px] bg-orange-50 border border-orange-200 text-orange-900">
                <Ban className="w-4 h-4 mt-0.5 shrink-0" />
                <div><b className="font-semibold">{sel.status === "SKIPPED" ? "No se envió." : "Falló el envío."}</b> {sel.reason}</div>
              </div>
            )}

            <div className="border border-gray-200 rounded-xl bg-white p-3.5 space-y-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Detalle del aviso</h3>
              <Row k="Evento">{EVENT_DETAIL[sel.event] ?? sel.eventLabel}</Row>
              <Row k="Canal">{channelDetail(sel)}</Row>
              {sel.templateName && <Row k="Plantilla"><span className="font-mono text-[11.5px] text-gray-700">{sel.templateName}</span></Row>}
              {sel.vars && <Row k="Variables">{Object.keys(sel.vars).filter((k) => k !== "enlace" && sel.vars?.[k]).join(" · ")}</Row>}
              {sel.link && <Row k="Enlace"><span className="inline-flex items-center gap-1.5 flex-wrap"><Link2 className="w-[13px] h-[13px] text-gray-400" /><span className="font-mono text-[11.5px] break-all">{sel.link.replace(/^https?:\/\//, "")}</span><span className="text-gray-400">{linkNote(sel)}</span></span></Row>}
              <Row k="Seguimiento"><span className="text-gray-700">{timeline(sel)}</span></Row>
              <div className="flex gap-2 flex-wrap pt-1.5">
                {sel.link && (
                  <a href={sel.link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-[10px] bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                    <ExternalLink className="w-[15px] h-[15px]" /> Abrir como el paciente
                  </a>
                )}
                <button type="button" onClick={copyText}
                  className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors ${copied ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}>
                  {copied ? <><Check className="w-[15px] h-[15px]" /> Copiado</> : <><Copy className="w-[15px] h-[15px]" /> Copiar texto</>}
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 text-xs leading-[18px]">
      <b className="text-gray-500 font-medium flex-[0_0_88px]">{k}</b>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
