"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Builder, type FormTemplate } from "@/components/form-builder";
import { CertificateTemplateModal } from "@/components/certificate-editor";
import { Car, Target, IdCard, Package, Clock, FileText, Award, Check, AlertTriangle, Minus, MoreVertical } from "lucide-react";

// Modal con el form builder del producto (abre el formulario activo o uno nuevo)
function ProductFormModal({ productId, productName, onClose }: { productId: string; productName?: string | undefined; onClose: () => void }) {
  const { data: forms, isLoading } = useQuery<FormTemplate[]>({
    queryKey: ["forms", productId],
    queryFn: () => apiFetch<FormTemplate[]>(`/products/${productId}/forms`),
  });
  const editing = forms ? (forms.find((f) => f.isActive) ?? forms[0] ?? null) : null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl my-4">
        {isLoading ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400">Cargando formulario...</div>
        ) : (
          <Builder productId={productId} productName={productName} editing={editing} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgeRule {
  minAge: number;
  maxAge: number;
  validityDays: number; // 0 = no permitido
}

interface RenewalRules {
  validityDays?: number;
  requiresMedical?: boolean;
  requiresPsych?: boolean;
  requiresVision?: boolean;
  ageRules?: AgeRule[];
}

interface Product {
  id: string;
  name: string;
  type: string;
  slotDuration: number;
  renewalRules: RenewalRules;
  active: boolean;
  hasOwnForm: boolean;
  hasCertificateTemplate: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = [
  { value: "CARNET_CONDUCIR", label: "Carnet de Conducir" },
  { value: "LICENCIA_ARMAS", label: "Licencia de Armas" },
  { value: "DNI", label: "DNI/Pasaporte" },
  { value: "OTRO", label: "Otro" },
];
const TYPE_MAP = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.value, t.label]));
const TYPE_ICON: Record<string, typeof Car> = {
  CARNET_CONDUCIR: Car,
  LICENCIA_ARMAS: Target,
  DNI: IdCard,
};

// ── Product Modal ─────────────────────────────────────────────────────────────

interface ProductFormData {
  name: string;
  type: string;
  slotDuration: string;
  useAgeRules: boolean;
  validityDays: string;
  ageRules: AgeRule[];
  requiresMedical: boolean;
  requiresPsych: boolean;
  requiresVision: boolean;
}

const EMPTY_FORM: ProductFormData = {
  name: "", type: "CARNET_CONDUCIR", slotDuration: "30",
  useAgeRules: false, validityDays: "", ageRules: [],
  requiresMedical: true, requiresPsych: true, requiresVision: true,
};

function fromProduct(p: Product): ProductFormData {
  const hasAgeRules = (p.renewalRules.ageRules?.length ?? 0) > 0;
  return {
    name: p.name,
    type: p.type,
    slotDuration: String(p.slotDuration),
    useAgeRules: hasAgeRules,
    validityDays: p.renewalRules.validityDays ? String(p.renewalRules.validityDays) : "",
    ageRules: (p.renewalRules.ageRules ?? []).map((r) => ({
      minAge: r.minAge,
      maxAge: r.maxAge,
      validityDays: r.validityDays ?? 0,
    })),
    requiresMedical: p.renewalRules.requiresMedical ?? false,
    requiresPsych: p.renewalRules.requiresPsych ?? false,
    requiresVision: p.renewalRules.requiresVision ?? false,
  };
}

// ── Age Rules Editor ──────────────────────────────────────────────────────────

function AgeRulesEditor({ rules, onChange }: { rules: AgeRule[]; onChange: (r: AgeRule[]) => void }) {
  function updateRule(i: number, field: keyof AgeRule, value: string) {
    const next = rules.map((r, idx) =>
      idx === i ? { ...r, [field]: parseInt(value) || 0 } : r
    );
    onChange(next);
  }

  function addRule() {
    const last = rules.length > 0 ? rules[rules.length - 1] : undefined;
    const lastMax = last ? last.maxAge : -1;
    onChange([...rules, { minAge: lastMax + 1, maxAge: lastMax + 10, validityDays: 365 }]);
  }

  function removeRule(i: number) {
    onChange(rules.filter((_, idx) => idx !== i));
  }

  // coverage validation feedback
  let coverageError: string | null = null;
  if (rules.length > 0) {
    const sorted = [...rules].sort((a, b) => a.minAge - b.minAge);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || first.minAge !== 0) coverageError = "El primer tramo debe empezar en 0";
    else {
      for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const prev = sorted[i - 1];
        if (!cur || !prev || cur.minAge !== prev.maxAge + 1) {
          coverageError = `Hueco o solapamiento entre ${prev?.maxAge} y ${cur?.minAge}`;
          break;
        }
      }
      if (!coverageError && last && last.maxAge < 120) {
        coverageError = `El último tramo debe llegar a 120 (actualmente ${last.maxAge})`;
      }
    }
  }

  return (
    <div className="space-y-2">
      {rules.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-2">Sin tramos — añade el primero</p>
      )}
      <div className="grid grid-cols-[3rem_4rem_0.5rem_4rem_1rem_5rem_auto] items-center gap-x-1.5 gap-y-2">
        {rules.length > 0 && (
          <>
            <span className="text-xs text-gray-400">Edad</span>
            <span className="text-xs text-gray-400">Desde</span>
            <span />
            <span className="text-xs text-gray-400">Hasta</span>
            <span />
            <span className="text-xs text-gray-400">Vigencia (días)</span>
            <span />
          </>
        )}
        {rules.map((rule, i) => (
          <>
            <span key={`lbl-${i}`} className="text-xs text-gray-500">Edad</span>
            <input key={`min-${i}`} type="number" min={0} max={120} value={rule.minAge}
              onChange={(e) => updateRule(i, "minAge", e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <span key={`sep-${i}`} className="text-xs text-gray-400 text-center">–</span>
            <input key={`max-${i}`} type="number" min={0} max={120} value={rule.maxAge}
              onChange={(e) => updateRule(i, "maxAge", e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <span key={`arr-${i}`} className="text-xs text-gray-400 text-center">→</span>
            <div key={`val-${i}`} className="relative">
              <input type="number" min={0} value={rule.validityDays}
                onChange={(e) => updateRule(i, "validityDays", e.target.value)}
                className={`w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                  rule.validityDays === 0 ? "border-red-200 bg-red-50 text-red-500" : "border-gray-300"
                }`} />
              {rule.validityDays === 0 && (
                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-red-400 pointer-events-none">✗</span>
              )}
            </div>
            <button key={`rm-${i}`} type="button" onClick={() => removeRule(i)}
              className="text-red-400 hover:text-red-600 text-sm leading-none justify-self-start">×</button>
          </>
        ))}
      </div>
      {rules.some((r) => r.validityDays === 0) && (
        <p className="text-xs text-red-400">Los tramos con 0 días se consideran <strong>no permitidos</strong></p>
      )}
      {coverageError && <p className="text-xs text-red-500">{coverageError}</p>}
      {!coverageError && rules.length > 0 && (
        <p className="text-xs text-emerald-600 font-medium">Cobertura completa (0–120)</p>
      )}
      <button type="button" onClick={addRule}
        className="text-xs px-3 py-1.5 rounded border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 w-full mt-1">
        + Añadir tramo
      </button>
    </div>
  );
}

function ProductModal({ product, onClose }: { product?: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductFormData>(product ? fromProduct(product) : EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!product;

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        type: form.type,
        slotDuration: parseInt(form.slotDuration),
        renewalRules: {
          requiresMedical: form.requiresMedical,
          requiresPsych: form.requiresPsych,
          requiresVision: form.requiresVision,
          ...(form.useAgeRules
            ? { ageRules: form.ageRules }
            : form.validityDays ? { validityDays: parseInt(form.validityDays) } : {}),
        },
      };
      return isEdit
        ? apiFetch(`/products/${product!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch("/products", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["products"] }); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Error al guardar"),
  });

  function toggle(key: "requiresMedical" | "requiresPsych" | "requiresVision") {
    setForm((f) => ({ ...f, [key]: !f[key] }));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{isEdit ? "Editar producto" : "Nuevo producto"}</h2>

        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
            <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Tipo + Duración */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo *</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {PRODUCT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Duración de cita (min) *</label>
              <input type="number" required min={5} max={120} step={5} value={form.slotDuration}
                onChange={(e) => setForm((f) => ({ ...f, slotDuration: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Reglas de renovación */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reglas de renovación</p>

            {/* Toggle: simple vs por edad */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              <button type="button" onClick={() => setForm((f) => ({ ...f, useAgeRules: false }))}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  !form.useAgeRules ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                }`}>
                Validez fija
              </button>
              <button type="button" onClick={() => setForm((f) => ({ ...f, useAgeRules: true }))}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  form.useAgeRules ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                }`}>
                Por tramos de edad
              </button>
            </div>

            {!form.useAgeRules ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Validez (días)</label>
                <input type="number" min={1} value={form.validityDays} placeholder="Ej: 365"
                  onChange={(e) => setForm((f) => ({ ...f, validityDays: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-400 mt-1">Días desde la revisión hasta la caducidad del documento</p>
              </div>
            ) : (
              <AgeRulesEditor
                rules={form.ageRules}
                onChange={(r) => setForm((f) => ({ ...f, ageRules: r }))}
              />
            )}

            <div className="space-y-2 pt-1">
              {(
                [
                  { key: "requiresMedical", label: "Requiere examen médico" },
                  { key: "requiresPsych", label: "Requiere examen psicotécnico" },
                  { key: "requiresVision", label: "Requiere examen de visión" },
                ] as { key: "requiresMedical" | "requiresPsych" | "requiresVision"; label: string }[]
              ).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={form[key]} onChange={() => toggle(key)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear producto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleActive = useMutation({
    mutationFn: () => apiFetch(`/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ active: !product.active }) }),
    onSuccess: () => { setMenuOpen(false); void queryClient.invalidateQueries({ queryKey: ["products"] }); },
  });

  const rules = product.renewalRules;
  const checks = [
    rules.requiresMedical && "Médico",
    rules.requiresPsych && "Psicotécnico",
    rules.requiresVision && "Visión",
  ].filter(Boolean) as string[];
  const hasAgeRules = (rules.ageRules?.length ?? 0) > 0;
  const allowed = hasAgeRules ? rules.ageRules!.filter((r) => r.validityDays > 0).length : 0;
  const denied = hasAgeRules ? rules.ageRules!.filter((r) => r.validityDays === 0).length : 0;
  const TypeIcon = TYPE_ICON[product.type] ?? Package;

  return (
    <>
      {editing && <ProductModal product={product} onClose={() => setEditing(false)} />}
      {showForm && <ProductFormModal productId={product.id} productName={product.name} onClose={() => setShowForm(false)} />}
      {showTemplate && <CertificateTemplateModal productId={product.id} productName={product.name} onClose={() => setShowTemplate(false)} />}

      <div className={`bg-white rounded-xl border p-4 flex flex-col ${product.active ? "border-gray-200" : "border-gray-200 opacity-70"}`}>
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-[15px] leading-snug">{product.name}</p>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <TypeIcon className="w-3.5 h-3.5 shrink-0" /> {TYPE_MAP[product.type] ?? product.type}
              <span className="text-gray-300">·</span>
              <Clock className="w-3 h-3 shrink-0" /> {product.slotDuration} min
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${product.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
              {product.active ? "Activo" : "Inactivo"}
            </span>
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} className="p-1 rounded-md hover:bg-gray-100 text-gray-400" aria-label="Más acciones">
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-8 z-20 w-40 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
                    <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {product.active ? "Desactivar producto" : "Activar producto"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Reglas de renovación */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {hasAgeRules ? (
            <>
              <span className="bg-purple-50 text-purple-700 text-[11px] px-2 py-0.5 rounded">{allowed} tramo{allowed === 1 ? "" : "s"} permitido{allowed === 1 ? "" : "s"}</span>
              {denied > 0 && <span className="bg-red-50 text-red-500 text-[11px] px-2 py-0.5 rounded">{denied} no permitido{denied === 1 ? "" : "s"}</span>}
            </>
          ) : rules.validityDays ? (
            <span className="bg-blue-50 text-blue-700 text-[11px] px-2 py-0.5 rounded">{rules.validityDays} días validez</span>
          ) : null}
          {checks.map((c) => (
            <span key={c} className="bg-gray-100 text-gray-600 text-[11px] px-2 py-0.5 rounded">{c}</span>
          ))}
          {checks.length === 0 && !rules.validityDays && !hasAgeRules && <span className="text-gray-400 text-[11px]">Sin reglas</span>}
        </div>

        {/* Estado de configuración */}
        <div className="border-t border-gray-100 pt-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Formulario exploración</span>
            {product.hasOwnForm ? (
              <span className="text-[11px] font-medium text-green-600 flex items-center gap-0.5"><Check className="w-3.5 h-3.5" /> Propio</span>
            ) : (
              <span className="text-[11px] font-medium text-amber-600 flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> Por defecto</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Plantilla certificado</span>
            {product.hasCertificateTemplate ? (
              <span className="text-[11px] font-medium text-green-600 flex items-center gap-0.5"><Check className="w-3.5 h-3.5" /> Propia</span>
            ) : (
              <span className="text-[11px] font-medium text-gray-400 flex items-center gap-0.5"><Minus className="w-3.5 h-3.5" /> Por defecto</span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex gap-1.5 mt-3">
          <button onClick={() => setShowForm(true)} className="flex-1 text-xs py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 text-blue-600">Formulario</button>
          <button onClick={() => setShowTemplate(true)} className="flex-1 text-xs py-1.5 rounded-lg border border-purple-200 hover:bg-purple-50 text-purple-600">Plantilla</button>
          <button onClick={() => setEditing(true)} className="flex-1 text-xs py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
        </div>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => apiFetch<Product[]>("/products"),
  });

  const visible = (products ?? []).filter((p) =>
    filter === "active" ? p.active : filter === "inactive" ? !p.active : true
  );

  const active = (products ?? []).filter((p) => p.active).length;
  const configured = (products ?? []).filter((p) => p.hasOwnForm && p.hasCertificateTemplate).length;
  const avgDuration = products && products.length > 0
    ? Math.round(products.reduce((s, p) => s + p.slotDuration, 0) / products.length)
    : 0;

  return (
    <div className="p-6 max-w-5xl">
      {showModal && <ProductModal onClose={() => setShowModal(false)} />}

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Productos</h1>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">
          + Nuevo producto
        </button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Total productos</p>
          <p className="text-2xl font-bold text-gray-800">{(products ?? []).length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Activos</p>
          <p className="text-2xl font-bold text-emerald-700">{active}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Configuración</p>
          <p className="text-2xl font-bold text-gray-800">{configured}<span className="text-sm font-normal text-gray-400 ml-1">/{(products ?? []).length} completos</span></p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Dur. media cita</p>
          <p className="text-2xl font-bold text-blue-700">{avgDuration}<span className="text-sm font-normal text-blue-400 ml-1">min</span></p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {(["all", "active", "inactive"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${filter === f ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            {f === "all" ? "Todos" : f === "active" ? "Activos" : "Inactivos"}
          </button>
        ))}
      </div>

      {isLoading && <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-gray-400">Cargando...</div>}
      {!isLoading && visible.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-gray-400">
          {filter === "all" ? "Sin productos registrados" : `Sin productos ${filter === "active" ? "activos" : "inactivos"}`}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visible.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
