"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, getAccessToken, getActAsTenant } from "@/lib/api";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, User, CircleCheck, Table2, StickyNote, PenLine, Upload, Trash2, ChevronDown, LayoutList, Code, Building2 } from "lucide-react";

// ── Config (espejo de apps/api/src/lib/certificate-config.ts) ───────────────────
type SectionId = "patient" | "result" | "fields" | "notes" | "signatures";
interface Section { id: SectionId; enabled: boolean; patientFields?: string[] }
interface CertificateConfig {
  accentColor: string;
  logoDataUrl?: string | null;
  showCenter: boolean;
  title: string;
  sections: Section[];
  showFooter: boolean;
  footerText?: string;
}
interface TemplateData { template: string | null; config: CertificateConfig | null; default: string; defaultConfig: CertificateConfig }

const ACCENTS = ["#1d4ed8", "#0f6e56", "#3b6d11", "#534ab7", "#b45309", "#444441"];
const PATIENT_FIELDS: { key: string; label: string }[] = [
  { key: "patientName", label: "Paciente" },
  { key: "patientDni", label: "DNI/NIE" },
  { key: "patientBirthDate", label: "Fecha nacimiento" },
  { key: "patientProvince", label: "Provincia" },
  { key: "completedAt", label: "Fecha revisión" },
  { key: "expiryDate", label: "Válido hasta" },
];
const SECTION_META: Record<SectionId, { label: string; icon: typeof User }> = {
  patient: { label: "Datos del paciente", icon: User },
  result: { label: "Resultado apto / no apto", icon: CircleCheck },
  fields: { label: "Datos del reconocimiento", icon: Table2 },
  notes: { label: "Observaciones", icon: StickyNote },
  signatures: { label: "Firmas", icon: PenLine },
};

const TEMPLATE_VARS: { v: string; desc: string }[] = [
  { v: "{{tenantName}}", desc: "Nombre de la empresa" },
  { v: "{{centerName}}", desc: "Nombre del centro" },
  { v: "{{centerLine}}", desc: "Dirección completa del centro" },
  { v: "{{centerCif}}", desc: "CIF del centro" },
  { v: "{{patientName}}", desc: "Nombre del paciente" },
  { v: "{{patientDni}}", desc: "DNI/NIE del paciente" },
  { v: "{{patientBirthDate}}", desc: "Fecha de nacimiento" },
  { v: "{{patientProvince}}", desc: "Provincia del paciente" },
  { v: "{{productName}}", desc: "Nombre del producto" },
  { v: "{{doctorName}}", desc: "Nombre del facultativo" },
  { v: "{{doctorLicense}}", desc: "Nº de colegiado" },
  { v: "{{outcomeLabel}}", desc: "Resultado (texto)" },
  { v: "{{#if apto}}…{{/if}}", desc: "Bloque condicional si es APTO" },
  { v: "{{completedAt}}", desc: "Fecha de la revisión" },
  { v: "{{expiryDate}}", desc: "Válido hasta" },
  { v: "{{notes}}", desc: "Observaciones" },
  { v: "{{generatedAt}}", desc: "Fecha/hora de generación" },
  { v: "{{#each fields}}{{this.label}}: {{this.value}}{{/each}}", desc: "Campos del formulario" },
  { v: "{{{signatureDataUrl}}}", desc: "Firma del paciente (img src)" },
  { v: "{{{doctorSignatureDataUrl}}}", desc: "Firma del médico (img src)" },
];

function templateErrorMessage(err: unknown): string {
  if (err instanceof ApiError && Array.isArray(err.errors) && (err.errors[0] as { message?: string })?.message) {
    return (err.errors[0] as { message: string }).message;
  }
  return err instanceof Error ? err.message : "Error al guardar";
}

function previewHeaders(): Record<string, string> {
  const token = getAccessToken();
  const actAs = getActAsTenant();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (actAs) headers["x-act-as-tenant"] = actAs;
  return headers;
}

// ── Fila de sección reordenable ─────────────────────────────────────────────────
function SortableSection({ section, onToggle, patientExpanded, onExpand, onToggleField }: {
  section: Section;
  onToggle: () => void;
  patientExpanded: boolean;
  onExpand: () => void;
  onToggleField: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const meta = SECTION_META[section.id];
  const Icon = meta.icon;
  const on = section.enabled;
  const fields = section.patientFields ?? PATIENT_FIELDS.map((f) => f.key);

  return (
    <div ref={setNodeRef} style={style} className="border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2 py-2">
        <button {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500" aria-label="Reordenar">
          <GripVertical className="w-4 h-4" />
        </button>
        <Icon className={`w-4 h-4 ${on ? "text-gray-500" : "text-gray-300"}`} />
        <span className={`flex-1 text-sm ${on ? "text-gray-800" : "text-gray-400"}`}>{meta.label}</span>
        {section.id === "patient" && on && (
          <button onClick={onExpand} className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-0.5">
            {fields.length} campos <ChevronDown className={`w-3.5 h-3.5 transition-transform ${patientExpanded ? "rotate-180" : ""}`} />
          </button>
        )}
        <Toggle on={on} onClick={onToggle} />
      </div>
      {section.id === "patient" && on && patientExpanded && (
        <div className="pl-8 pb-2 grid grid-cols-2 gap-1">
          {PATIENT_FIELDS.map((f) => {
            const checked = fields.includes(f.key);
            return (
              <label key={f.key} className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => onToggleField(f.key)} className="w-3.5 h-3.5 rounded" />
                {f.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative w-8 h-[18px] rounded-full transition-colors ${on ? "bg-blue-600" : "bg-gray-300"}`} aria-pressed={on}>
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}

export function CertificateTemplateModal({ productId, productName, onClose }: { productId: string; productName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<TemplateData>({
    queryKey: ["product-template", productId],
    queryFn: () => apiFetch(`/products/${productId}/template`),
  });

  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [config, setConfig] = useState<CertificateConfig | null>(null);
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [showVars, setShowVars] = useState(false);
  const [patientExpanded, setPatientExpanded] = useState(false);
  const inited = useRef(false);

  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    setHtml(data.template ?? "");
    if (data.config) { setConfig(data.config); setMode("visual"); }
    else if (data.template) { setConfig(data.defaultConfig); setMode("html"); }
    else { setConfig(data.defaultConfig); setMode("visual"); }
  }, [data]);

  // Vista previa en vivo (debounced): pide el HTML renderizado al servidor.
  useEffect(() => {
    if (!config) return;
    const payload = mode === "visual" ? { config } : { template: html };
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/proxy/products/${productId}/template/preview-html`, {
          method: "POST", headers: previewHeaders(), body: JSON.stringify(payload),
        });
        if (res.ok) setPreviewHtml(await res.text());
      } catch { /* preview no crítico */ }
    }, 300);
    return () => clearTimeout(t);
  }, [config, html, mode, productId]);

  const save = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/template`, {
      method: "PUT",
      body: JSON.stringify(mode === "visual" ? { config } : { template: html.trim() ? html : null }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["product-template", productId] }); void queryClient.invalidateQueries({ queryKey: ["products"] }); onClose(); },
    onError: (err: unknown) => setError(templateErrorMessage(err)),
  });

  // Restablece el editor a la configuración por defecto (sin guardar ni cerrar).
  // Se persiste al pulsar Guardar. Clona para no mutar la referencia de defaultConfig.
  function resetToDefault() {
    if (!data) return;
    setConfig(JSON.parse(JSON.stringify(data.defaultConfig)) as CertificateConfig);
    setHtml("");
    setMode("visual");
    setPatientExpanded(false);
    setError(null);
  }

  async function previewPdf() {
    setPreviewing(true); setError(null);
    try {
      const payload = mode === "visual" ? { config } : { template: html };
      const res = await fetch(`/api/proxy/products/${productId}/template/preview`, {
        method: "POST", headers: previewHeaders(), body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { errors?: { message?: string }[] } | null;
        throw new Error(j?.errors?.[0]?.message ?? "No se pudo generar la vista previa");
      }
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error en la vista previa");
    } finally {
      setPreviewing(false);
    }
  }

  function patch(p: Partial<CertificateConfig>) { setConfig((c) => (c ? { ...c, ...p } : c)); }
  function toggleSection(id: SectionId) {
    setConfig((c) => c ? { ...c, sections: c.sections.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s) } : c);
  }
  function togglePatientField(key: string) {
    setConfig((c) => {
      if (!c) return c;
      return { ...c, sections: c.sections.map((s) => {
        if (s.id !== "patient") return s;
        const cur = s.patientFields ?? PATIENT_FIELDS.map((f) => f.key);
        const next = cur.includes(key) ? cur.filter((k) => k !== key) : PATIENT_FIELDS.map((f) => f.key).filter((k) => cur.includes(k) || k === key);
        return { ...s, patientFields: next };
      }) };
    });
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setConfig((c) => c ? { ...c, sections: arrayMove(c.sections, c.sections.findIndex((s) => s.id === active.id), c.sections.findIndex((s) => s.id === over.id)) } : c);
  }

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) { setError("El logo no debe superar 1,5 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-5xl my-4 p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900">Plantilla del certificado</h2>
        <p className="text-sm text-gray-500 mb-4">{productName}</p>

        {isLoading || !config ? (
          <div className="py-16 text-center text-gray-400">Cargando plantilla…</div>
        ) : (
          <>
            {/* Selector de modo */}
            <div className="inline-flex gap-0.5 bg-gray-100 rounded-lg p-0.5 mb-4">
              <button onClick={() => setMode("visual")} className={`text-sm px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === "visual" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>
                <LayoutList className="w-4 h-4" /> Editor visual
              </button>
              <button onClick={() => setMode("html")} className={`text-sm px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === "html" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>
                <Code className="w-4 h-4" /> HTML avanzado
              </button>
            </div>

            <div className="grid grid-cols-[1fr_1fr] gap-5">
              {/* ── Configuración ── */}
              <div>
                {mode === "visual" ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Marca y estilo</p>
                      <div className="flex gap-3">
                        <div>
                          {config.logoDataUrl ? (
                            <div className="relative w-[72px] h-14 rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={config.logoDataUrl} alt="logo" className="max-h-12 max-w-full" />
                              <button onClick={() => patch({ logoDataUrl: null })} className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-gray-200 p-0.5 text-gray-400 hover:text-red-500">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <label className="w-[72px] h-14 rounded-lg border border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-400 cursor-pointer hover:border-blue-400 hover:text-blue-500">
                              <Upload className="w-4 h-4" />
                              <span className="text-[11px]">Logo</span>
                              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogo} className="hidden" />
                            </label>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-600 mb-1.5">Color de acento</p>
                          <div className="flex gap-1.5">
                            {ACCENTS.map((c) => (
                              <button key={c} onClick={() => patch({ accentColor: c })}
                                className={`w-6 h-6 rounded-full ${config.accentColor.toLowerCase() === c ? "ring-2 ring-offset-2 ring-gray-400" : ""}`}
                                style={{ backgroundColor: c }} aria-label={`Color ${c}`} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-600 mb-1">Título del certificado</p>
                      <input value={config.title} onChange={(e) => patch({ title: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>

                    <div>
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Secciones</p>
                      {/* Membrete (fijo arriba) */}
                      <div className="flex items-center gap-2 py-2 border-b border-gray-100">
                        <span className="w-4" />
                        <Building2 className={`w-4 h-4 ${config.showCenter ? "text-gray-500" : "text-gray-300"}`} />
                        <span className={`flex-1 text-sm ${config.showCenter ? "text-gray-800" : "text-gray-400"}`}>Datos del centro</span>
                        <Toggle on={config.showCenter} onClick={() => patch({ showCenter: !config.showCenter })} />
                      </div>
                      {/* Secciones reordenables */}
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                        <SortableContext items={config.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                          {config.sections.map((s) => (
                            <SortableSection key={s.id} section={s}
                              onToggle={() => toggleSection(s.id)}
                              patientExpanded={patientExpanded}
                              onExpand={() => setPatientExpanded((v) => !v)}
                              onToggleField={togglePatientField} />
                          ))}
                        </SortableContext>
                      </DndContext>
                      {/* Pie (fijo abajo) */}
                      <div className="flex items-center gap-2 py-2 border-t border-gray-100">
                        <span className="w-4" />
                        <StickyNote className={`w-4 h-4 ${config.showFooter ? "text-gray-500" : "text-gray-300"}`} />
                        <span className={`flex-1 text-sm ${config.showFooter ? "text-gray-800" : "text-gray-400"}`}>Pie de página</span>
                        <Toggle on={config.showFooter} onClick={() => patch({ showFooter: !config.showFooter })} />
                      </div>
                      {config.showFooter && (
                        <input value={config.footerText ?? ""} onChange={(e) => patch({ footerText: e.target.value })}
                          placeholder="Texto del pie (vacío = por defecto)"
                          className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600">HTML / Handlebars</label>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setShowVars((s) => !s)} className="text-[11px] text-blue-600 hover:underline">{showVars ? "Ocultar variables" : "Ver variables"}</button>
                        <button type="button" onClick={() => data && setHtml(data.default)} className="text-[11px] text-gray-500 hover:underline">Cargar plantilla por defecto</button>
                      </div>
                    </div>
                    {showVars && (
                      <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 grid grid-cols-1 gap-y-1">
                        {TEMPLATE_VARS.map((t) => (
                          <div key={t.v} className="flex items-baseline gap-2 text-[11px]">
                            <code className="text-purple-700 whitespace-nowrap">{t.v}</code>
                            <span className="text-gray-500 truncate">{t.desc}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <textarea value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false}
                      className="w-full h-80 font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Vacío = se usa la plantilla por defecto del sistema" />
                    <p className="mt-2 text-[11px] text-amber-600">Al guardar en modo HTML, este producto dejará de usar el editor visual.</p>
                  </div>
                )}
              </div>

              {/* ── Vista previa en vivo ── */}
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Vista previa</p>
                <div className="rounded-lg border border-gray-200 bg-gray-100 h-[460px] overflow-hidden">
                  {previewHtml
                    ? <iframe srcDoc={previewHtml} title="Vista previa del certificado" className="w-full h-full border-0 bg-white" />
                    : <div className="h-full flex items-center justify-center text-gray-400 text-sm">Generando vista previa…</div>}
                </div>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <button type="button" onClick={previewPdf} disabled={previewing}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50">
                  {previewing ? "Generando…" : "Vista previa (PDF)"}
                </button>
                <button type="button" onClick={resetToDefault}
                  className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                  Restablecer a por defecto
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {save.isPending ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
