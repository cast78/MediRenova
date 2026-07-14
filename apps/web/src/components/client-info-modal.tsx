"use client";

// Ficha rápida del cliente (contacto + consentimientos), compartida por Reservas y
// Visitas. Se abre al pulsar el nombre del cliente en la Lista/Agenda.
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Phone, MessageCircle, Mail, MapPin } from "lucide-react";

interface ClientInfo {
  firstName: string | null; lastName: string | null; dni: string | null; email: string | null; phone: string | null;
  province: string | null; municipality: string | null; gdprConsentAt: string | null;
  acceptsEmail: boolean; acceptsSms: boolean; acceptsWhatsapp: boolean;
}

function getInitials(firstName: string | null, lastName: string | null): string {
  const f = (firstName ?? "").trim(); const l = (lastName ?? "").trim();
  if (!f && !l) return "?";
  return `${f[0] ?? ""}${l[0] ?? ""}`.toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ["bg-violet-500", "bg-blue-500", "bg-cyan-500", "bg-teal-500", "bg-indigo-500", "bg-fuchsia-500", "bg-rose-500", "bg-orange-500"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length] ?? "bg-gray-400";
}
function waNorm(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("34")) return d;
  if (d.length === 9) return "34" + d;
  return d;
}

function ConsentPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-gray-300"}`} />{label}
    </span>
  );
}

export function ClientInfoModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const router = useRouter();
  const { data: c, isLoading } = useQuery<ClientInfo>({
    queryKey: ["customer-quick", customerId],
    queryFn: () => apiFetch<ClientInfo>(`/customers/${customerId}`),
  });
  const name = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre" : "";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-full ${avatarColor(name || "?")} flex items-center justify-center text-white text-sm font-semibold shrink-0`}>{getInitials(c?.firstName ?? null, c?.lastName ?? null)}</div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{name || "Cargando…"}</p>
              {c?.dni && <p className="text-xs text-gray-500">{c.dni}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400 py-4">Cargando…</p>
        ) : c ? (
          <>
            <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
              {c.phone ? (
                <div className="flex items-center gap-2.5">
                  <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                  <a href={`tel:${c.phone}`} className="text-gray-800 hover:text-blue-700">{c.phone}</a>
                  <a href={`https://wa.me/${waNorm(c.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="text-emerald-600 hover:text-emerald-700 ml-auto"><MessageCircle className="w-4 h-4" /></a>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 text-gray-400"><Phone className="w-4 h-4 shrink-0" />Sin teléfono</div>
              )}
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                {c.email ? <a href={`mailto:${c.email}`} className="text-gray-800 hover:text-blue-700 truncate">{c.email}</a> : <span className="text-gray-400">Sin email</span>}
              </div>
              {(c.municipality || c.province) && (
                <div className="flex items-center gap-2.5">
                  <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-gray-800">{[c.municipality, c.province].filter(Boolean).join(" · ")}</span>
                </div>
              )}
            </div>
            <div className="border-t border-gray-100 mt-3 pt-3">
              <p className="text-xs text-gray-400 mb-2">Consentimiento de contacto</p>
              <div className="flex flex-wrap gap-2">
                <ConsentPill on={c.acceptsWhatsapp} label="WhatsApp" />
                <ConsentPill on={c.acceptsEmail} label="Email" />
                <ConsentPill on={c.acceptsSms} label="SMS" />
              </div>
            </div>
            <div className="border-t border-gray-100 mt-3 pt-3">
              <p className="text-xs text-gray-400 mb-2">Consentimiento GDPR</p>
              {c.gdprConsentAt ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Firmado · {new Date(c.gdprConsentAt).toLocaleDateString("es-ES")}</span>
              ) : (
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Pendiente</span>
                  <button onClick={() => router.push(`/customers/${customerId}?tab=rgpd`)} className="text-xs text-blue-600 hover:underline">Gestionar →</button>
                </div>
              )}
            </div>
            <button onClick={() => router.push(`/customers/${customerId}`)} className="mt-4 w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700">Ver ficha completa →</button>
          </>
        ) : (
          <p className="text-sm text-gray-400 py-4">No se pudo cargar el cliente.</p>
        )}
      </div>
    </div>
  );
}
