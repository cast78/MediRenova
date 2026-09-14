"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ShieldCheck, MailCheck, IdCard, CalendarDays } from "lucide-react";
import { portalFetch } from "../portal";

// Solicitar acceso al portal: DNI + fecha de nacimiento. Si coinciden con la ficha,
// el backend envía un enlace al email almacenado. Respuesta siempre genérica.
export default function RequestAccessPage() {
  const params = useParams();
  const slug = String((params as { slug?: string }).slug ?? "");
  const [dni, setDni] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await portalFetch("request-access", { method: "POST", body: JSON.stringify({ tenantSlug: slug, dni: dni.trim(), birthDate }) });
    } catch { /* respuesta genérica igualmente */ }
    setSent(true);
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-teal-500 px-6 py-4 text-white">
        <div className="flex items-center gap-2.5">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/20 shrink-0"><ShieldCheck className="w-5 h-5" /></div>
          <h1 className="text-lg font-bold">Accede a tu área</h1>
        </div>
        <p className="text-sm text-white/85 mt-1">Consulta y descarga tus reconocimientos y citas.</p>
      </div>

      <div className="p-6">
        {sent ? (
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 mb-3"><MailCheck className="w-7 h-7" /></div>
            <p className="text-sm text-gray-700">Si tus datos coinciden con tu ficha, te hemos enviado un <b>enlace de acceso</b> a tu email.</p>
            <p className="text-xs text-gray-400 mt-2">Revisa tu bandeja (y la carpeta de spam). El enlace caduca en 60 minutos.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><IdCard className="w-3.5 h-3.5 text-blue-500" /> DNI</span>
              <input value={dni} onChange={(e) => setDni(e.target.value)} required placeholder="12345678Z"
                className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-blue-500" /> Fecha de nacimiento</span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required
                className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400" />
            </label>
            <button type="submit" disabled={busy || !dni || !birthDate}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-teal-500 text-white font-medium text-sm hover:opacity-95 disabled:opacity-50 shadow-sm transition-opacity">
              {busy ? "Enviando…" : "Recibir enlace de acceso"}
            </button>
            <p className="text-[11px] text-gray-400 text-center">Te enviamos un enlace al email de tu ficha. Sin contraseñas.</p>
          </form>
        )}
      </div>
    </div>
  );
}
