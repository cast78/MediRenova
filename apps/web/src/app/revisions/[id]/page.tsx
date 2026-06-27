"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getAccessToken } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormField {
  name: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "textarea" | "date";
  required?: boolean;
  options?: string[];
  unit?: string;
}

interface FormSchema {
  fields: FormField[];
}

interface Attachment {
  id: string;
  fieldId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface Revision {
  id: string;
  outcome: string;
  formData: Record<string, unknown>;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiryDate: string | null;
  attachments: Attachment[];
  formTemplate: {
    id: string;
    name: string;
    schema: FormSchema;
  };
  appointment: {
    scheduledAt: string;
    customer: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      birthDate: string | null;
    };
    product: { name: string };
  };
}

// ── Dynamic form renderer ─────────────────────────────────────────────────────

function DynamicField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const base =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50";

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 rounded border-gray-300 text-blue-600"
        />
        <span className="text-sm text-gray-700">{value ? "Sí" : "No"}</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={base}
      >
        <option value="">— Seleccionar —</option>
        {field.options?.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className={`${base} resize-none`}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
        disabled={disabled}
        className={`${base} flex-1`}
      />
      {field.unit && <span className="text-sm text-gray-500 shrink-0">{field.unit}</span>}
    </div>
  );
}

// ── Attachment thumbnail (carga binaria con token) ─────────────────────────────

function AttachmentThumb({
  revisionId,
  att,
  onDelete,
  canDelete,
}: {
  revisionId: string;
  att: Attachment;
  onDelete: (id: string) => void;
  canDelete: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = att.mimeType.startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    let revoked = false;
    let objectUrl: string | null = null;
    void (async () => {
      const token = getAccessToken();
      const res = await fetch(`/api/proxy/revisions/${revisionId}/attachments/${att.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok || revoked) return;
      const blob = await res.blob();
      if (revoked) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [revisionId, att.id, isImage]);

  async function open() {
    const token = getAccessToken();
    const res = await fetch(`/api/proxy/revisions/${revisionId}/attachments/${att.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    window.open(u, "_blank");
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  }

  return (
    <div className="relative group w-24">
      <button
        onClick={open}
        className="w-24 h-24 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center hover:border-blue-400"
        title={att.fileName}
      >
        {isImage && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={att.fileName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-gray-400 px-1 text-center break-all">{isImage ? "…" : "PDF"}</span>
        )}
      </button>
      {canDelete && (
        <button
          onClick={() => onDelete(att.id)}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Eliminar adjunto"
        >
          ×
        </button>
      )}
      <p className="mt-1 text-[10px] text-gray-500 truncate" title={att.fileName}>{att.fileName}</p>
    </div>
  );
}

// ── Signature pad (canvas) ──────────────────────────────────────────────────────

function SignaturePad({ onSave, saving }: { onSave: (blob: Blob) => void; saving: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  function coords(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = coords(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = coords(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }
  function save() {
    canvasRef.current!.toBlob((b) => { if (b) onSave(b); }, "image/png");
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={500}
        height={160}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full border border-gray-300 rounded-lg bg-white touch-none cursor-crosshair"
        style={{ aspectRatio: "500 / 160" }}
      />
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={clear} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Limpiar</button>
        <button type="button" onClick={save} disabled={!hasInk || saving}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar firma"}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RevisionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: revision, isLoading } = useQuery<Revision>({
    queryKey: ["revision", id],
    queryFn: () => apiFetch<Revision>(`/revisions/${id}`),
  });

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"APTO" | "NO_APTO">("APTO");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingSig, setSavingSig] = useState(false);

  const isCompleted = revision?.outcome !== "PENDING";

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    const token = getAccessToken();
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/proxy/revisions/${id}/attachments`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error("No se pudo subir el archivo (revisa tipo/tamaño)");
      }
      await queryClient.invalidateQueries({ queryKey: ["revision", id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir adjunto");
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(attId: string) {
    const token = getAccessToken();
    await fetch(`/api/proxy/revisions/${id}/attachments/${attId}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await queryClient.invalidateQueries({ queryKey: ["revision", id] });
  }

  async function uploadSignature(blob: Blob) {
    setSavingSig(true);
    setError(null);
    const token = getAccessToken();
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      // Reemplaza la firma anterior, si existe
      for (const a of (revision?.attachments ?? []).filter((x) => x.fieldId === "signature")) {
        await fetch(`/api/proxy/revisions/${id}/attachments/${a.id}`, { method: "DELETE", headers: authHeader });
      }
      const fd = new FormData();
      fd.append("file", new File([blob], "firma.png", { type: "image/png" }));
      const res = await fetch(`/api/proxy/revisions/${id}/attachments?fieldId=signature`, {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      if (!res.ok) throw new Error("No se pudo guardar la firma");
      await queryClient.invalidateQueries({ queryKey: ["revision", id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar la firma");
    } finally {
      setSavingSig(false);
    }
  }

  async function viewCertificate() {
    setPdfLoading(true);
    setError(null);
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/proxy/revisions/${id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("No se pudo generar el certificado");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al abrir el certificado");
    } finally {
      setPdfLoading(false);
    }
  }

  // Seed form data from saved draft when revision loads
  useEffect(() => {
    if (revision) {
      setFormData((revision.formData as Record<string, unknown>) ?? {});
      setNotes(revision.notes ?? "");
    }
  }, [revision]);

  // Auto-save draft every time a field changes (debounced by useMutation)
  const saveDraft = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch(`/revisions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ formData: data }),
      }),
    onSuccess: () => {
      setSaveMsg("Borrador guardado");
      setTimeout(() => setSaveMsg(null), 2000);
    },
  });

  const complete = useMutation({
    mutationFn: () =>
      apiFetch(`/revisions/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({ formData, outcome, notes }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["revision", id] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al completar la revisión");
    },
  });

  function handleFieldChange(name: string, value: unknown) {
    const next = { ...formData, [name]: value };
    setFormData(next);
    saveDraft.mutate(next);
  }

  if (isLoading) return <div className="p-6 text-gray-400 text-sm">Cargando revisión...</div>;
  if (!revision) return <div className="p-6 text-red-500 text-sm">Revisión no encontrada</div>;

  const { appointment, formTemplate } = revision;
  const fields: FormField[] = formTemplate.schema?.fields ?? [];
  const allAttachments = revision.attachments ?? [];
  const signatureAtt = allAttachments.find((a) => a.fieldId === "signature");
  const generalAttachments = allAttachments.filter((a) => a.fieldId !== "signature");

  return (
    <div className="p-6 max-w-2xl">
      {/* Back + header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Volver</button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Revisión — {appointment.customer.firstName} {appointment.customer.lastName}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {appointment.product.name} · {new Date(appointment.scheduledAt).toLocaleDateString("es-ES")}
          </p>
        </div>
        {isCompleted && (
          <span className={`ml-auto text-xs px-3 py-1 rounded-full font-medium ${revision.outcome === "APTO" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {revision.outcome === "APTO" ? "✓ Apto" : "✗ No apto"}
          </span>
        )}
      </div>

      {/* Patient summary */}
      <div className="bg-blue-50 rounded-xl px-5 py-4 mb-5 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-blue-400 text-xs">Paciente</span>
          <p className="font-medium text-gray-900">{appointment.customer.firstName} {appointment.customer.lastName}</p>
        </div>
        <div>
          <span className="text-blue-400 text-xs">Fecha nacimiento</span>
          <p className="text-gray-700">
            {appointment.customer.birthDate
              ? new Date(appointment.customer.birthDate).toLocaleDateString("es-ES")
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-blue-400 text-xs">Teléfono</span>
          <p className="text-gray-700">{appointment.customer.phone ?? "—"}</p>
        </div>
        <div>
          <span className="text-blue-400 text-xs">Formulario</span>
          <p className="text-gray-700">{formTemplate.name}</p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-900">Datos de la exploración</h2>
          {!isCompleted && saveMsg && (
            <span className="text-xs text-green-600">{saveMsg}</span>
          )}
        </div>

        {fields.length === 0 && (
          <p className="text-sm text-gray-400">Este formulario no tiene campos definidos.</p>
        )}

        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <DynamicField
                field={field}
                value={formData[field.name]}
                onChange={(v) => handleFieldChange(field.name, v)}
                disabled={isCompleted}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Attachments */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-900">Adjuntos</h2>
          {!isCompleted && (
            <label className={`text-xs px-3 py-1.5 rounded-lg cursor-pointer font-medium ${uploading ? "bg-gray-100 text-gray-400" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              {uploading ? "Subiendo..." : "+ Añadir foto/PDF"}
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                disabled={uploading}
                className="hidden"
                onChange={(e) => { void uploadFiles(e.target.files); e.target.value = ""; }}
              />
            </label>
          )}
        </div>
        {generalAttachments.length === 0 ? (
          <p className="text-sm text-gray-400">Sin adjuntos.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {generalAttachments.map((att) => (
              <AttachmentThumb
                key={att.id}
                revisionId={id}
                att={att}
                onDelete={(aid) => void deleteAttachment(aid)}
                canDelete={!isCompleted}
              />
            ))}
          </div>
        )}
      </div>

      {/* Signature */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="font-medium text-gray-900 mb-4">Firma del paciente</h2>
        {signatureAtt ? (
          <div className="flex items-start gap-4">
            <AttachmentThumb
              revisionId={id}
              att={signatureAtt}
              onDelete={(aid) => void deleteAttachment(aid)}
              canDelete={!isCompleted}
            />
            {!isCompleted && <p className="text-xs text-gray-400 pt-1">Firma guardada. Bórrala para volver a firmar.</p>}
          </div>
        ) : isCompleted ? (
          <p className="text-sm text-gray-400">Sin firma registrada.</p>
        ) : (
          <SignaturePad onSave={(blob) => void uploadSignature(blob)} saving={savingSig} />
        )}
      </div>

      {/* Notes + outcome + complete */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium text-gray-900 mb-4">Resultado</h2>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notas clínicas</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isCompleted}
            rows={3}
            placeholder="Observaciones, restricciones, recomendaciones..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:bg-gray-50"
          />
        </div>

        {!isCompleted && (
          <>
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">Dictamen *</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setOutcome("APTO")}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${outcome === "APTO" ? "border-green-500 bg-green-50 text-green-700" : "border-gray-200 text-gray-500 hover:border-green-300"}`}
                >
                  ✓ Apto
                </button>
                <button
                  onClick={() => setOutcome("NO_APTO")}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${outcome === "NO_APTO" ? "border-red-500 bg-red-50 text-red-700" : "border-gray-200 text-gray-500 hover:border-red-300"}`}
                >
                  ✗ No apto
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

            <button
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
              className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {complete.isPending ? "Finalizando..." : "Finalizar revisión"}
            </button>
          </>
        )}

        {isCompleted && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Dictamen</span>
              <span className={`font-medium ${revision.outcome === "APTO" ? "text-green-600" : "text-red-600"}`}>
                {revision.outcome === "APTO" ? "✓ Apto" : "✗ No apto"}
              </span>
            </div>
            {revision.expiryDate && (
              <div className="flex justify-between">
                <span className="text-gray-500">Próxima revisión</span>
                <span className="text-gray-900">{new Date(revision.expiryDate).toLocaleDateString("es-ES")}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Completada</span>
              <span className="text-gray-900">{revision.completedAt ? new Date(revision.completedAt).toLocaleString("es-ES") : "—"}</span>
            </div>

            {error && <p className="text-sm text-red-600 pt-1">{error}</p>}

            <button
              onClick={viewCertificate}
              disabled={pdfLoading}
              className="w-full mt-2 py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {pdfLoading ? "Generando certificado..." : "Ver certificado (PDF)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
