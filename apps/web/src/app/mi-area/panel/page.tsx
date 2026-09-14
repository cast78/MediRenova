"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, CalendarDays, Download, LogOut } from "lucide-react";
import { getPortalToken, portalFetch, openPortalPdf, clearPortalToken } from "../portal";

interface Me { name: string; center: string | null }
interface Rev { id: string; outcome: string; completedAt: string | null; expiryDate: string | null; product: string | null }
interface Appt { id: string; scheduledAt: string; status: string; product: string | null; center: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pendiente", cls: "bg-amber-100 text-amber-700" },
  CONFIRMED: { label: "Confirmada", cls: "bg-blue-100 text-blue-700" },
  ATTENDED: { label: "Atendida", cls: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Cancelada", cls: "bg-red-100 text-red-600" },
  RESCHEDULED: { label: "Reprogramada", cls: "bg-violet-100 text-violet-700" },
  NO_SHOW: { label: "No presentado", cls: "bg-orange-100 text-orange-700" },
  CLOSED_ADMIN: { label: "Cerrada", cls: "bg-gray-100 text-gray-600" },
};
const fmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");

const AVATAR = ["bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500"];
function avatarColor(n: string) { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff; return AVATAR[h % AVATAR.length]!; }
function initials(n: string) { const p = n.trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || (p[0]?.slice(0, 2) ?? "?")).toUpperCase(); }

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

  const name = me?.name ?? "Paciente";
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-teal-500 px-5 py-5 flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full ${avatarColor(name)} ring-2 ring-white/60 flex items-center justify-center text-white font-bold shrink-0`}>{initials(name)}</div>
          <div className="text-white min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-white/70">Mi área</p>
            <h1 className="text-lg font-bold truncate">{name}</h1>
            {me?.center && <p className="text-xs text-white/85 truncate">{me.center}</p>}
          </div>
        </div>
      </div>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-blue-600" /> Mis reconocimientos</h2>
        {revs.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no tienes reconocimientos completados.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {revs.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.product ?? "Reconocimiento"}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${r.outcome === "APTO" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{r.outcome === "APTO" ? "Apto" : "No apto"}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{fmt(r.completedAt)}{r.expiryDate ? ` · caduca ${fmt(r.expiryDate)}` : ""}</p>
                </div>
                <button disabled={pdfBusy === r.id} onClick={() => download(r.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 font-medium disabled:opacity-50">
                  <Download className="w-3.5 h-3.5" /> {pdfBusy === r.id ? "Abriendo…" : "PDF"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-teal-600" /> Mis citas</h2>
        {appts.length === 0 ? (
          <p className="text-sm text-gray-400">No tienes citas registradas.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {appts.map((a) => {
              const s = STATUS[a.status] ?? { label: a.status, cls: "bg-gray-100 text-gray-600" };
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.product ?? "Cita"}</p>
                    <p className="text-xs text-gray-500 truncate">{fmt(a.scheduledAt)} · {a.scheduledAt.slice(11, 16)}{a.center ? ` · ${a.center}` : ""}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold ${s.cls}`}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <button onClick={() => { clearPortalToken(); setAuthed(false); }} className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 py-2"><LogOut className="w-3.5 h-3.5" /> Salir</button>
    </div>
  );
}
