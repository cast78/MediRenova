"use client";

// Página/tarjeta de módulo bloqueado por plan (crm-planes P3). No se esconde el
// módulo: se explica qué aporta y se puede pedir el cambio a Pro con un clic.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, Sparkles, Check, Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { FeatureKey } from "@/lib/use-features";

interface Copy { title: string; intro: string; benefits: string[] }

const COPY: Record<FeatureKey, Copy> = {
  campaigns: {
    title: "Campañas y segmentos",
    intro: "Escribe una vez y llega a los pacientes adecuados: renovaciones próximas, inactivos, por producto o provincia.",
    benefits: ["Segmentos guardados con vista previa de destinatarios", "Envío inmediato o programado por email, WhatsApp o SMS", "Contadores de enviados, omitidos y fallidos con el consentimiento RGPD aplicado"],
  },
  workflow: {
    title: "Renovación automática",
    intro: "El sistema avisa solo a cada paciente cuando su certificado está a punto de caducar, con un enlace para reservar en un minuto.",
    benefits: ["Reglas por producto: días de antelación, reintentos y tope", "Enlace de auto-reserva de 30 días que se detiene al reservar", "Traza de cada aviso en la ficha del paciente"],
  },
  analytics_pro: {
    title: "Analítica avanzada",
    intro: "De dónde vienen los pacientes, dónde se pierden y qué ocupación real tiene cada sala y cada médico.",
    benefits: ["Embudo reserva → visita → reconocimiento con fugas por motivo", "Saturación y ocupación por centro, sala y médico", "Comparativas por periodo y drill-down a las citas"],
  },
  captacion: {
    title: "Captación",
    intro: "Mide qué campañas traen citas de verdad y cuántos pacientes nuevos entran cada mes.",
    benefits: ["Altas por periodo y canal, nuevos frente a recurrentes", "Efectividad de cada campaña: conversión dentro de su ventana", "Exportación a CSV"],
  },
  messaging: {
    title: "Avisos automáticos y Comunicaciones",
    intro: "Confirmaciones, recordatorios e invitaciones salen solos por el canal que cada paciente ha consentido; aquí ves qué recibió y si llegó.",
    benefits: ["Cita creada, reprogramada y recordatorio sin que recepción escriba nada", "Elección automática de canal: WhatsApp → SMS → email según consentimiento", "Vista previa de cada aviso y estado de entrega por paciente"],
  },
  recovery: {
    title: "Recuperación de no-shows",
    intro: "Cada cita perdida es una cita recuperable: bandeja de pacientes que faltaron, invitación a reagendar y tasa de recuperación.",
    benefits: ["Lista de no-shows recientes con quién se contactó y por qué vía", "Invitación a reagendar con enlace de reserva en un clic", "KPI de recuperación: cuántas citas perdidas vuelven a la agenda"],
  },
  public_booking: {
    title: "Reserva pública y auto-reserva",
    intro: "Los pacientes reservan solos desde un enlace o desde tu web, respetando horarios, salas y productos.",
    benefits: ["Enlace mágico de reserva para renovaciones y recuperaciones", "API pública para integrar la reserva en tu web", "Una reserva activa por paciente y producto, sin solapes"],
  },
  api_public: {
    title: "API e integraciones",
    intro: "Conecta MediRenova con tu web, tu centralita o tu software de gestión.",
    benefits: ["Claves de API por empresa con revocación", "Alta de pacientes y reservas desde fuera", "Consulta de productos, centros y disponibilidad"],
  },
  channels: {
    title: "Canales de mensajería",
    intro: "Conecta WhatsApp Business, email y SMS para que los avisos lleguen de verdad al paciente.",
    benefits: ["WhatsApp (Meta Cloud API) con plantillas aprobadas", "Email con tu dominio y remitente", "SMS como canal de respaldo"],
  },
  portal_full: {
    title: "Portal del paciente completo",
    intro: "Además de descargar certificados, el paciente ve sus citas y reserva su renovación desde su área.",
    benefits: ["Próximas citas e historial en Mi área", "Renovación en un clic cuando el certificado está por caducar", "Menos llamadas a recepción"],
  },
  portal_certificates: { title: "Portal del paciente", intro: "", benefits: [] },
  analytics_basic: { title: "KPIs operativos", intro: "", benefits: [] },
};

export function LockedModule({ feature, compact = false }: { feature: FeatureKey; compact?: boolean }) {
  const c = COPY[feature];
  const [sent, setSent] = useState(false);
  const request = useMutation({
    mutationFn: () => apiFetch("/tenants/me/plan-request", { method: "POST", body: JSON.stringify({ feature }) }),
    onSuccess: () => setSent(true),
  });

  return (
    <div className={`bg-white rounded-xl border border-gray-200 ${compact ? "p-5" : "p-8"} max-w-3xl`}>
      <div className="flex items-start gap-4">
        <span className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 inline-flex items-center justify-center shrink-0"><Lock className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-gray-900">{c.title}</h2>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"><Sparkles className="w-3 h-3" /> Plan Pro</span>
          </div>
          <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{c.intro}</p>
          {c.benefits.length > 0 && (
            <ul className="mt-4 space-y-2">
              {c.benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-gray-700"><Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />{b}</li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {sent ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><Check className="w-4 h-4" /> Petición enviada. Te contactaremos en breve.</span>
            ) : (
              <button type="button" onClick={() => request.mutate()} disabled={request.isPending}
                className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {request.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Quiero pasar a Pro
              </button>
            )}
            {request.isError && <span className="text-sm text-red-600">No se pudo enviar la petición. Inténtalo de nuevo.</span>}
            <span className="text-xs text-gray-400">Tus datos no cambian: al pasar a Pro, este módulo se abre al instante.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
