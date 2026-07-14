"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, authHeaders } from "@/lib/api";
import { Search, UserPlus, Pencil, CheckCircle2, Building2, Stethoscope, Upload, PenLine, X, Trash2, Ban } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";

interface DoctorCenter { id: string; name: string }
interface Doctor {
  id: string; email: string; firstName: string; lastName: string;
  dni: string | null; licenseNumber: string | null; active: boolean;
  hasSignature: boolean; centers: DoctorCenter[];
}
interface Center { id: string; name: string; active: boolean }
interface Tenant { name: string }

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

// ── Signature image (carga binaria con token) ────────────────────────────────────

function SignatureImg({ doctorId, refresh }: { doctorId: string; refresh: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let obj: string | null = null;
    void (async () => {
      const res = await fetch(`/api/proxy/doctors/${doctorId}/signature`, { headers: authHeaders() });
      if (!res.ok || revoked) return;
      const blob = await res.blob();
      if (revoked) return;
      obj = URL.createObjectURL(blob);
      setUrl(obj);
    })();
    return () => { revoked = true; if (obj) URL.revokeObjectURL(obj); };
  }, [doctorId, refresh]);
  if (!url) return <span className="text-xs text-gray-400">Sin firma</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="firma" className="h-8 max-w-[90px] object-contain" />;
}

// ── Modal ───────────────────────────────────────────────────────────────────────

interface DoctorForm {
  email: string; firstName: string; lastName: string; dni: string; licenseNumber: string; centerIds: string[]; password: string;
}

function DoctorModal({ doctor, centers, onClose }: { doctor?: Doctor; centers: Center[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isEdit = !!doctor;
  const [form, setForm] = useState<DoctorForm>(
    doctor
      ? { email: doctor.email, firstName: doctor.firstName, lastName: doctor.lastName, dni: doctor.dni ?? "", licenseNumber: doctor.licenseNumber ?? "", centerIds: doctor.centers.map((c) => c.id), password: "" }
      : { email: "", firstName: "", lastName: "", dni: "", licenseNumber: "", centerIds: [], password: "" },
  );
  const [active, setActive] = useState(doctor?.active ?? true);
  const [hasSig, setHasSig] = useState(doctor?.hasSignature ?? false);
  const [sigRefresh, setSigRefresh] = useState(0);
  const [drawMode, setDrawMode] = useState(false);
  const sigPadRef = useRef<SignaturePadHandle>(null);
  // Firma pendiente (solo en alta): se retiene local y se adjunta tras crear el médico.
  const [pendingSig, setPendingSig] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleCenter(id: string) {
    setForm((f) => ({ ...f, centerIds: f.centerIds.includes(id) ? f.centerIds.filter((x) => x !== id) : [...f.centerIds, id] }));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const body: Record<string, unknown> = { firstName: form.firstName, lastName: form.lastName, dni: form.dni || null, licenseNumber: form.licenseNumber || null, centerIds: form.centerIds, active };
        if (form.password) body["password"] = form.password;
        return apiFetch(`/doctors/${doctor.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      // Alta: crea el médico y, si dibujó/subió firma, la adjunta con el id recién creado.
      const created = await apiFetch<{ id: string }>("/doctors", { method: "POST", body: JSON.stringify({ email: form.email, firstName: form.firstName, lastName: form.lastName, dni: form.dni || undefined, licenseNumber: form.licenseNumber || undefined, centerIds: form.centerIds, password: form.password }) });
      if (pendingSig && created?.id) {
        const fd = new FormData();
        fd.append("file", pendingSig.blob, "firma.png");
        await fetch(`/api/proxy/doctors/${created.id}/signature`, { method: "POST", headers: authHeaders(), body: fd });
      }
      return created;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["doctors"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  // Guarda una firma (imagen o trazo) en el endpoint del médico (solo en edición: existe id).
  async function putSignature(blob: Blob, filename: string): Promise<boolean> {
    if (!doctor) return false;
    setError(null);
    const fd = new FormData();
    fd.append("file", blob, filename);
    const res = await fetch(`/api/proxy/doctors/${doctor.id}/signature`, { method: "POST", headers: authHeaders(), body: fd });
    if (!res.ok) { setError("No se pudo guardar la firma (PNG/JPG/WEBP)"); return false; }
    setHasSig(true); setSigRefresh((n) => n + 1);
    void queryClient.invalidateQueries({ queryKey: ["doctors"] });
    return true;
  }
  // En alta no hay id todavía: la firma se retiene localmente (con preview) hasta Guardar.
  function retainPending(blob: Blob) {
    setPendingSig((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { blob, url: URL.createObjectURL(blob) }; });
  }
  async function uploadSignature(file: File | undefined) {
    if (!file) return;
    if (isEdit) await putSignature(file, file.name); else retainPending(file);
  }
  async function saveDrawnSignature() {
    const blob = await sigPadRef.current?.toBlob();
    if (!blob) { setError("Dibuja la firma antes de guardar."); return; }
    if (isEdit) { if (await putSignature(blob, "firma.png")) setDrawMode(false); }
    else { retainPending(blob); setDrawMode(false); }
  }
  async function removeSignature() {
    if (isEdit && doctor) {
      await fetch(`/api/proxy/doctors/${doctor.id}/signature`, { method: "DELETE", headers: authHeaders() });
      setHasSig(false); setSigRefresh((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: ["doctors"] });
    } else {
      setPendingSig((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
    }
  }
  const sigShown = isEdit ? hasSig : !!pendingSig;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} aria-label="Cerrar" className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-3 mb-4">
          <span className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0"><Stethoscope className="w-[18px] h-[18px] text-blue-600" /></span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">{isEdit ? "Editar médico" : "Nuevo médico"}</h2>
            <p className="text-xs text-gray-400">{isEdit ? "Datos, centros y firma" : "Alta de un nuevo facultativo"}</p>
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Apellidos *</label>
              <input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">DNI</label>
              <input value={form.dni} onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nº Colegiado *</label>
              <input required value={form.licenseNumber} onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email {isEdit ? "" : "*"}</label>
              <input type="email" required={!isEdit} disabled={isEdit} value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? "bg-gray-50 text-gray-500 cursor-not-allowed" : ""}`} />
              {isEdit && <p className="text-[11px] text-gray-400 mt-1">El email de acceso no se cambia aquí.</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{isEdit ? "Nueva contraseña" : "Contraseña *"}</label>
              <input type="password" required={!isEdit} minLength={8} value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={isEdit ? "Dejar en blanco para no cambiar" : ""}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {isEdit && <p className="text-[11px] text-gray-400 mt-1">Mínimo 8 caracteres si la cambias.</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Centros asignados</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {centers.length === 0 && <p className="text-xs text-gray-400 px-1">No hay centros</p>}
              {centers.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={form.centerIds.includes(c.id)} onChange={() => toggleCenter(c.id)} className="w-4 h-4" />
                  <span className="text-sm text-gray-800">{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Firma del médico</label>
            {drawMode ? (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-2">Dibuja la firma con el ratón o el dedo.</p>
                <SignaturePad ref={sigPadRef} />
                <div className="flex items-center gap-2 mt-2">
                  <button type="button" onClick={() => void saveDrawnSignature()} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">Guardar firma</button>
                  <button type="button" onClick={() => { setDrawMode(false); setError(null); }} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 min-w-[120px] h-[52px] flex items-center justify-center overflow-hidden">
                  {isEdit
                    ? (hasSig ? <SignatureImg doctorId={doctor.id} refresh={sigRefresh} /> : <span className="text-xs text-gray-400">Sin firma</span>)
                    : (pendingSig
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={pendingSig.url} alt="firma" className="h-8 max-w-[90px] object-contain" />
                      : <span className="text-xs text-gray-400">Sin firma</span>)}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => { setError(null); setDrawMode(true); }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1.5"><PenLine className="w-3.5 h-3.5" />Dibujar</button>
                  <label className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />Subir
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void uploadSignature(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  {sigShown && (
                    <button type="button" onClick={() => void removeSignature()}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />Quitar</button>
                  )}
                </div>
              </div>
            )}
            {!isEdit && <p className="text-[11px] text-gray-400 mt-1.5">Se adjuntará al crear el médico.</p>}
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4" />
              Médico activo
            </label>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={save.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {save.isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500"];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
const docInitials = (first: string, last: string) => ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "?";

export default function DoctorsPage() {
  const [showNew, setShowNew] = useState(false);
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null);
  const [search, setSearch] = useState("");
  const [centerFilter, setCenterFilter] = useState("");

  const queryClient = useQueryClient();
  const { data: doctors, isLoading } = useQuery<Doctor[]>({ queryKey: ["doctors"], queryFn: () => apiFetch<Doctor[]>("/doctors") });
  const { data: centers } = useQuery<Center[]>({ queryKey: ["centers"], queryFn: () => apiFetch<Center[]>("/centers") });
  const activeCenters = (centers ?? []).filter((c) => c.active);

  // Activar/desactivar un médico directamente desde la lista (sin abrir el modal).
  const toggleActive = useMutation({
    mutationFn: (d: Doctor) => apiFetch(`/doctors/${d.id}`, { method: "PATCH", body: JSON.stringify({ active: !d.active }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["doctors"] }),
  });

  const visible = (doctors ?? []).filter((d) => {
    const matchesName = `${d.firstName} ${d.lastName}`.toLowerCase().includes(search.toLowerCase());
    const matchesCenter = !centerFilter || d.centers.some((c) => c.id === centerFilter);
    return matchesName && matchesCenter;
  });

  return (
    <div className="p-6 max-w-6xl">
      {showNew && <DoctorModal centers={activeCenters} onClose={() => setShowNew(false)} />}
      {editDoctor && <DoctorModal doctor={editDoctor} centers={activeCenters} onClose={() => setEditDoctor(null)} />}

      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Médicos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestión de médicos y sus centros asignados</p>
        </div>
        <button onClick={() => setShowNew(true)} className="px-3.5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium inline-flex items-center gap-1.5 shrink-0">
          <UserPlus className="w-4 h-4" /> Nuevo médico
        </button>
      </div>

      <div className="flex gap-2.5 mb-5 flex-wrap">
        <div className="relative w-64 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={centerFilter} onChange={(e) => setCenterFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos los centros</option>
          {activeCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Médico</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">DNI</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Nº Colegiado</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Centros asignados</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Firma</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Estado</th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>}
            {!isLoading && visible.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin médicos</td></tr>}
            {visible.map((d) => {
              const fullName = `${d.firstName} ${d.lastName}`.trim();
              return (
                <tr key={d.id} onClick={() => setEditDoctor(d)}
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${!d.active ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-7 h-7 rounded-full ${avatarColor(fullName)} flex items-center justify-center text-white text-[11px] font-bold shrink-0`}>{docInitials(d.firstName, d.lastName)}</span>
                      <span className="font-medium text-gray-900">{fullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{d.dni ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{d.licenseNumber ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {d.centers.length ? (
                      <div className="flex flex-wrap gap-1">
                        {d.centers.map((c) => (
                          <span key={c.id} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            <Building2 className="w-3 h-3 text-gray-400" />{c.name}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-gray-300">Sin centros</span>}
                  </td>
                  <td className="px-4 py-2.5">{d.hasSignature ? <SignatureImg doctorId={d.id} refresh={0} /> : <span className="text-xs text-gray-300">Sin firma</span>}</td>
                  <td className="px-4 py-2.5">
                    {d.active
                      ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />Activo</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Inactivo</span>}
                  </td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 justify-end">
                      {d.active ? (
                        <button onClick={() => toggleActive.mutate(d)} disabled={toggleActive.isPending} title="Desactivar médico"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          <Ban className="w-3.5 h-3.5" />Desactivar
                        </button>
                      ) : (
                        <button onClick={() => toggleActive.mutate(d)} disabled={toggleActive.isPending} title="Activar médico"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />Activar
                        </button>
                      )}
                      <button onClick={() => setEditDoctor(d)} title="Editar" aria-label="Editar"
                        className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"><Pencil className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
