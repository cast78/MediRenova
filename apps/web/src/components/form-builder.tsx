"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
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

// ── Types ───────────────────────────────────────────────────────────────────────

export type FieldType = "text" | "number" | "boolean" | "select" | "textarea" | "date";

export interface BuilderField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  unit: string;
}

export interface Product {
  id: string;
  name: string;
  active: boolean;
}

export interface FormTemplate {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
  schema: { fields?: Array<Omit<BuilderField, "id"> & { options?: string[] }> };
}

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sí / No",
  select: "Lista",
  textarea: "Texto largo",
  date: "Fecha",
};
const TYPES = Object.keys(TYPE_LABELS) as FieldType[];

const BASE_TEMPLATES: Record<string, Omit<BuilderField, "id">[]> = {
  "Reconocimiento conducir": [
    { name: "agudeza_visual", label: "Agudeza visual", type: "number", required: true, options: [], unit: "/10" },
    { name: "campo_visual_ok", label: "Campo visual normal", type: "boolean", required: false, options: [], unit: "" },
    { name: "audicion_ok", label: "Audición normal", type: "boolean", required: false, options: [], unit: "" },
    { name: "observaciones", label: "Observaciones", type: "textarea", required: false, options: [], unit: "" },
  ],
  "Licencia de armas": [
    { name: "agudeza_visual", label: "Agudeza visual", type: "number", required: true, options: [], unit: "/10" },
    { name: "equilibrio_ok", label: "Equilibrio correcto", type: "boolean", required: false, options: [], unit: "" },
    { name: "estado_psicologico", label: "Estado psicológico", type: "select", required: true, options: ["Apto", "Con observaciones"], unit: "" },
    { name: "observaciones", label: "Observaciones", type: "textarea", required: false, options: [], unit: "" },
  ],
  DNI: [
    { name: "identidad_verificada", label: "Identidad verificada", type: "boolean", required: true, options: [], unit: "" },
    { name: "foto_tomada", label: "Fotografía tomada", type: "boolean", required: false, options: [], unit: "" },
    { name: "observaciones", label: "Observaciones", type: "textarea", required: false, options: [], unit: "" },
  ],
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const e = err.errors;
    if (Array.isArray(e) && e[0]?.message) return e[0].message;
    if (e && typeof e === "object") {
      const msgs = Object.values(e as Record<string, string[]>).flat().filter(Boolean);
      if (msgs.length) return msgs.join(" · ");
    }
    return `Error ${err.status}`;
  }
  return err instanceof Error ? err.message : "Error";
}

function uid(): string {
  return crypto.randomUUID();
}

// ── Sortable field row ────────────────────────────────────────────────────────

function SortableField({ field, selected, onSelect, onRemove }: {
  field: BuilderField; selected: boolean; onSelect: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${selected ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white"}`}>
      <button {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500 px-1" aria-label="Reordenar">⠿</button>
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <span className="text-sm text-gray-900">{field.label || field.name}</span>
        <span className="ml-2 text-[10px] text-gray-400 uppercase">{TYPE_LABELS[field.type]}{field.required ? " · obl." : ""}</span>
      </button>
      <button onClick={onRemove} className="text-gray-300 hover:text-red-500 text-lg leading-none px-1" aria-label="Quitar">×</button>
    </div>
  );
}

// ── Preview ───────────────────────────────────────────────────────────────────

function FormPreview({ fields }: { fields: BuilderField[] }) {
  const base = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50";
  return (
    <div className="space-y-4">
      {fields.length === 0 && <p className="text-sm text-gray-400">Añade campos para ver la vista previa.</p>}
      {fields.map((f) => (
        <div key={f.id}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{f.label || f.name}{f.required && <span className="text-red-500 ml-1">*</span>}</label>
          {f.type === "boolean" ? (
            <input type="checkbox" disabled className="w-4 h-4" />
          ) : f.type === "select" ? (
            <select disabled className={base}><option>— Seleccionar —</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
          ) : f.type === "textarea" ? (
            <textarea disabled rows={2} className={`${base} resize-none`} />
          ) : (
            <div className="flex items-center gap-2">
              <input disabled type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} className={base} />
              {f.unit && <span className="text-sm text-gray-400">{f.unit}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function Builder({ productId, editing, onClose }: { productId: string; editing: FormTemplate | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(editing?.name ?? "");
  const [fields, setFields] = useState<BuilderField[]>(
    (editing?.schema.fields ?? []).map((f) => ({
      id: uid(), name: f.name, label: f.label, type: f.type as FieldType,
      required: !!f.required, options: f.options ?? [], unit: f.unit ?? "",
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const selected = fields.find((f) => f.id === selectedId) ?? null;

  function addField(type: FieldType) {
    const n = fields.length + 1;
    const f: BuilderField = { id: uid(), name: `campo_${n}`, label: "Nuevo campo", type, required: false, options: type === "select" ? ["Opción 1"] : [], unit: "" };
    setFields((arr) => [...arr, f]);
    setSelectedId(f.id);
  }
  function update(id: string, patch: Partial<BuilderField>) {
    setFields((arr) => arr.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function loadTemplate(key: string) {
    setFields((BASE_TEMPLATES[key] ?? []).map((f) => ({ id: uid(), ...f })));
    setSelectedId(null);
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setFields((arr) => arrayMove(arr, arr.findIndex((f) => f.id === active.id), arr.findIndex((f) => f.id === over.id)));
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        fields: fields.map((f) => ({
          name: f.name.trim(), label: f.label.trim(), type: f.type, required: f.required,
          ...(f.type === "select" ? { options: f.options } : {}),
          ...(f.unit.trim() ? { unit: f.unit.trim() } : {}),
        })),
      };
      return editing
        ? apiFetch(`/forms/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : apiFetch(`/products/${productId}/forms`, { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["forms", productId] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  function submit() {
    setError(null);
    if (name.trim().length < 2) return setError("El nombre del formulario es obligatorio");
    if (fields.length === 0) return setError("Añade al menos un campo");
    const names = new Set<string>();
    for (const f of fields) {
      if (!f.name.trim()) return setError("Todos los campos necesitan un nombre");
      if (names.has(f.name.trim())) return setError(`Campo duplicado: ${f.name}`);
      names.add(f.name.trim());
      if (f.type === "select" && f.options.filter(Boolean).length === 0) return setError(`"${f.label}" (lista) necesita opciones`);
    }
    save.mutate();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del formulario"
          className="text-lg font-semibold text-gray-900 border-b border-gray-200 focus:border-blue-500 focus:outline-none px-1 py-1 w-72" />
        <div className="flex gap-2">
          <button onClick={() => setPreview((v) => !v)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">{preview ? "Editar" : "Vista previa"}</button>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Cancelar</button>
          <button onClick={submit} disabled={save.isPending} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{save.isPending ? "Guardando..." : "Guardar"}</button>
        </div>
      </div>

      {!editing && fields.length === 0 && (
        <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
          <span>Plantilla base:</span>
          {Object.keys(BASE_TEMPLATES).map((k) => (
            <button key={k} onClick={() => loadTemplate(k)} className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">{k}</button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {preview ? (
        <div className="max-w-md"><FormPreview fields={fields} /></div>
      ) : (
        <div className="grid grid-cols-[1fr_280px] gap-5">
          {/* Canvas */}
          <div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {TYPES.map((t) => (
                <button key={t} onClick={() => addField(t)} className="text-xs px-2.5 py-1.5 rounded-lg border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-gray-600">+ {TYPE_LABELS[t]}</button>
              ))}
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {fields.length === 0 && <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">Añade campos con los botones de arriba</p>}
                  {fields.map((f) => (
                    <SortableField key={f.id} field={f} selected={f.id === selectedId} onSelect={() => setSelectedId(f.id)} onRemove={() => { setFields((a) => a.filter((x) => x.id !== f.id)); if (selectedId === f.id) setSelectedId(null); }} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* Properties panel */}
          <div className="border-l border-gray-100 pl-5">
            {!selected ? (
              <p className="text-sm text-gray-400">Selecciona un campo para editar sus propiedades.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase">Propiedades</p>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Etiqueta</label>
                  <input value={selected.label} onChange={(e) => update(selected.id, { label: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Nombre (clave)</label>
                  <input value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Tipo</label>
                  <select value={selected.type} onChange={(e) => update(selected.id, { type: e.target.value as FieldType })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
                    {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                {selected.type === "select" && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Opciones (una por línea)</label>
                    <textarea value={selected.options.join("\n")} onChange={(e) => update(selected.id, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} rows={4} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm resize-none" />
                  </div>
                )}
                {(selected.type === "text" || selected.type === "number") && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Unidad (opcional)</label>
                    <input value={selected.unit} onChange={(e) => update(selected.id, { unit: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={selected.required} onChange={(e) => update(selected.id, { required: e.target.checked })} className="w-4 h-4" />
                  Obligatorio
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
