"use client";

// Diálogo de confirmación genérico (panel de proveedor): texto según la acción,
// botón de confirmar con tono (azul / verde / ámbar / rojo) y, opcionalmente,
// un campo de nota (p. ej. motivo de rechazo) que se pasa a onConfirm.
import { useState } from "react";
import { X, Loader2, AlertTriangle, Check } from "lucide-react";

export interface ConfirmSpec {
  title: string;
  text: React.ReactNode;
  confirmLabel: string;
  tone?: "blue" | "green" | "amber" | "red";
  noteLabel?: string;
  noteRequired?: boolean;
  onConfirm: (note: string) => void | Promise<void>;
}

const TONE = {
  blue: "bg-blue-600 hover:bg-blue-700",
  green: "bg-emerald-600 hover:bg-emerald-700",
  amber: "bg-amber-600 hover:bg-amber-700",
  red: "bg-red-600 hover:bg-red-700",
};

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const tone = spec.tone ?? "blue";
  const canConfirm = !busy && (!spec.noteRequired || note.trim().length >= 3);
  async function confirm() {
    setBusy(true);
    try { await spec.onConfirm(note.trim()); onClose(); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-gray-900/45 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-labelledby="confirm-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-xl inline-flex items-center justify-center ${tone === "red" ? "bg-red-50 text-red-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"}`}>
            {tone === "red" || tone === "amber" ? <AlertTriangle className="w-5 h-5" /> : <Check className="w-5 h-5" />}
          </span>
          <h2 id="confirm-title" className="text-lg font-semibold text-gray-900 flex-1">{spec.title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>
        <div className="text-sm text-gray-700 leading-relaxed">{spec.text}</div>
        {spec.noteLabel && (
          <label className="block">
            <span className="text-xs font-medium text-gray-600">{spec.noteLabel}{spec.noteRequired && <span className="text-red-600"> *</span>}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {spec.noteRequired && note.trim().length > 0 && note.trim().length < 3 && <span className="block mt-1 text-[11px] text-amber-700">Escribe un motivo un poco más explicativo (mínimo 3 caracteres).</span>}
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={confirm} disabled={!canConfirm} className={`inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 ${TONE[tone]}`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
