"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ApptData {
  scheduledAt: string;
  status: string;
  product: { name: string } | null;
  room: { name: string; center: { name: string; address: string | null; city: string | null; lat: number | null; lng: number | null } | null } | null;
  customer: { firstName: string | null; lastName: string | null };
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Fecha "de pared" naíf → "jueves, 12 de julio · 10:00".
function fmtWhen(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return `${DAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} · ${iso.slice(11, 16)}`;
}

// Enlace a Google Maps del centro: por coordenadas si las hay, si no por dirección.
function mapsUrl(c: NonNullable<ApptData["room"]>["center"]): string | null {
  if (!c) return null;
  if (c.lat != null && c.lng != null) return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
  const addr = [c.address, c.city].filter(Boolean).join(", ");
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}

type Screen = "loading" | "ready" | "confirmed" | "cancelled" | "error";

export default function ConfirmarPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [screen, setScreen] = useState<Screen>("loading");
  const [appt, setAppt] = useState<ApptData | null>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("Este enlace no es válido o ha caducado.");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/link/${token}/appointment`);
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.data) { setErrMsg(json.errors?.[0]?.message ?? "Enlace inválido o caducado."); setScreen("error"); return; }
        const a: ApptData = json.data;
        setAppt(a);
        // Si ya está en un estado terminal, se muestra el resultado directamente.
        if (a.status === "CANCELLED" || a.status === "RESCHEDULED") setScreen("cancelled");
        else if (a.status === "ATTENDED" || a.status === "NO_SHOW") setScreen("confirmed");
        else setScreen("ready");
      } catch {
        if (alive) setScreen("error");
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function act(action: "confirm" | "cancel") {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/link/${token}/appointment/${action}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setErrMsg(json.errors?.[0]?.message ?? "No se pudo completar la acción."); setScreen("error"); return; }
      setScreen(action === "confirm" ? "confirmed" : "cancelled");
    } catch {
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }

  const center = appt?.room?.center;
  const name = appt ? `${appt.customer.firstName ?? ""}`.trim() : "";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
        <div className="text-center mb-6">
          <p className="text-lg font-bold text-blue-600">{center?.name ?? "MediRenova"}</p>
          {screen === "ready" && name && <p className="text-sm text-gray-500 mt-1">Hola {name}, confirma tu cita</p>}
        </div>

        {screen === "loading" && <p className="text-center text-sm text-gray-400 py-8">Cargando…</p>}

        {screen === "error" && (
          <div className="text-center py-6">
            <IconCircle tone="gray"><path d="M12 9v4M12 17h.01" /></IconCircle>
            <p className="text-gray-700 font-medium mt-3">{errMsg}</p>
            <p className="text-sm text-gray-400 mt-1">Contacta con el centro si necesitas ayuda.</p>
          </div>
        )}

        {appt && (screen === "ready" || screen === "confirmed" || screen === "cancelled") && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-5">
            <Row label="Servicio" value={appt.product?.name ?? "—"} />
            <Row label="Cuándo" value={fmtWhen(appt.scheduledAt)} highlight />
            {center && (
              <Row
                label="Dónde"
                value={`${center.name}${center.address ? ` · ${center.address}` : ""}${center.city ? `, ${center.city}` : ""}`}
                after={mapsUrl(center) ? (
                  <a
                    href={mapsUrl(center)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Ver en Google Maps"
                    title="Ver ubicación en Google Maps"
                    className="text-gray-400 hover:text-blue-600 transition-colors shrink-0"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </a>
                ) : undefined}
              />
            )}
          </div>
        )}

        {screen === "ready" && (
          <div className="space-y-2.5">
            <button onClick={() => act("confirm")} disabled={busy}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {busy ? "…" : "Confirmar asistencia"}
            </button>
            <button onClick={() => act("cancel")} disabled={busy}
              className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
              No podré ir
            </button>
            <p className="text-xs text-gray-400 text-center pt-1">Si no puedes asistir, avísanos aquí y liberaremos tu hueco.</p>
          </div>
        )}

        {screen === "confirmed" && (
          <div className="text-center py-2">
            <IconCircle tone="green"><path d="M20 6 9 17l-5-5" /></IconCircle>
            <p className="text-gray-900 font-semibold mt-3">¡Cita confirmada!</p>
            <p className="text-sm text-gray-500 mt-1">Te esperamos. Gracias.</p>
          </div>
        )}

        {screen === "cancelled" && (
          <div className="text-center py-2">
            <IconCircle tone="gray"><path d="M18 6 6 18M6 6l12 12" /></IconCircle>
            <p className="text-gray-900 font-semibold mt-3">Cita cancelada</p>
            <p className="text-sm text-gray-500 mt-1">Gracias por avisar. Si quieres, reserva otra fecha con el centro.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, highlight, after }: { label: string; value: string; highlight?: boolean; after?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <span className="text-sm text-gray-400 shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 justify-end min-w-0">
        <span className={`text-sm text-right ${highlight ? "font-semibold text-gray-900" : "text-gray-700"}`}>{value}</span>
        {after}
      </span>
    </div>
  );
}

function IconCircle({ tone, children }: { tone: "green" | "gray"; children: React.ReactNode }) {
  const cls = tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400";
  return (
    <span className={`inline-flex items-center justify-center w-14 h-14 rounded-full ${cls}`}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </span>
  );
}
