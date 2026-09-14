"use client";

import { useEffect, useState } from "react";
import { getPortalToken, portalFetch, openPortalPdf, clearPortalToken } from "../portal";

interface Me { name: string; center: string | null }
interface Rev { id: string; outcome: string; completedAt: string | null; expiryDate: string | null; product: string | null }
interface Appt { id: string; scheduledAt: string; status: string; product: string | null; center: string | null }

const STATUS: Record<string, string> = {
  PENDING: "Pendiente", CONFIRMED: "Confirmada", ATTENDED: "Atendida", CANCELLED: "Cancelada",
  RESCHEDULED: "Reprogramada", NO_SHOW: "No presentado", CLOSED_ADMIN: "Cerrada",
};
const fmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function PanelPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [revs, setRevs] = useState<Rev[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!getPortalToken()) { setAuthed(false); return; }
    (async () => {
      try {
        const [m, r, a] = await Promise.all([portalFetch<Me>("me"), portalFetch<Rev[]>("revisions"), portalFetch<Appt[]>("appointments")]);
        setMe(m); setRevs(r); setAppts(a); setAuthed(true);
      } catch { clearPortalToken(); setAuthed(false); }
    })();
  }, []);

  async function download(id: string) {
    setPdfBusy(id);
    try { await openPortalPdf(id); } catch { alert("No se pudo abrir el certificado."); }
    setPdfBusy(null);
  }

  if (authed === null) return <p className="text-gray-500 text-sm text-center py-10">Cargando…</p>;
  if (!authed) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
        <h1 className="text-lg font-bold text-gray-900 mb-1">Sesión no iniciada</h1>
        <p className="text-sm text-gray-500">Tu sesión ha caducado o no has entrado desde el enlace. Vuelve a solicitar acceso desde el enlace de tu centro.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wide">Mi área</p>
        <h1 className="text-xl font-bold text-gray-900">{me?.name}</h1>
        {me?.center && <p className="text-sm text-gray-500">{me.center}</p>}
      </div>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Mis reconocimientos</h2>
        {revs.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no tienes reconocimientos completados.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {revs.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.product ?? "Reconocimiento"}</p>
                  <p className="text-xs text-gray-500">
                    <span className={r.outcome === "APTO" ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>{r.outcome === "APTO" ? "Apto" : "No apto"}</span>
                    {" · "}{fmt(r.completedAt)}{r.expiryDate ? ` · caduca ${fmt(r.expiryDate)}` : ""}
                  </p>
                </div>
                <button disabled={pdfBusy === r.id} onClick={() => download(r.id)}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 font-medium disabled:opacity-50">
                  {pdfBusy === r.id ? "Abriendo…" : "Descargar PDF"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Mis citas</h2>
        {appts.length === 0 ? (
          <p className="text-sm text-gray-400">No tienes citas registradas.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {appts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{a.product ?? "Cita"}</p>
                  <p className="text-xs text-gray-500 truncate">{fmt(a.scheduledAt)} · {a.scheduledAt.slice(11, 16)}{a.center ? ` · ${a.center}` : ""}</p>
                </div>
                <span className="shrink-0 text-xs text-gray-500">{STATUS[a.status] ?? a.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button onClick={() => { clearPortalToken(); setAuthed(false); }} className="w-full text-xs text-gray-400 hover:text-gray-600 py-2">Salir</button>
    </div>
  );
}
