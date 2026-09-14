"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <h1 className="text-xl font-bold text-gray-900">Mi área</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">Accede a tus reconocimientos y citas.</p>

      {sent ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm px-4 py-3">
          Si tus datos coinciden con nuestra ficha, te hemos enviado un <b>enlace de acceso</b> a tu email. Revisa tu bandeja (y la carpeta de spam). El enlace caduca en 60 minutos.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">DNI</span>
            <input value={dni} onChange={(e) => setDni(e.target.value)} required placeholder="12345678Z"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Fecha de nacimiento</span>
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </label>
          <button type="submit" disabled={busy || !dni || !birthDate}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Enviando…" : "Recibir enlace de acceso"}
          </button>
          <p className="text-[11px] text-gray-400 text-center">Te enviaremos un enlace al email que consta en tu ficha. No pedimos contraseña.</p>
        </form>
      )}
    </div>
  );
}
