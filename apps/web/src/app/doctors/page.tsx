"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, getAccessToken } from "@/lib/api";

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
      const token = getAccessToken();
      const res = await fetch(`/api/proxy/doctors/${doctorId}/signature`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
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
  const [error, setError] = useState<string | null>(null);

  function toggleCenter(id: string) {
    setForm((f) => ({ ...f, centerIds: f.centerIds.includes(id) ? f.centerIds.filter((x) => x !== id) : [...f.centerIds, id] }));
  }

  const save = useMutation({
    mutationFn: () => {
      if (isEdit) {
        const body: Record<string, unknown> = { firstName: form.firstName, lastName: form.lastName, dni: form.dni || null, licenseNumber: form.licenseNumber || null, centerIds: form.centerIds, active };
        if (form.password) body["password"] = form.password;
        return apiFetch(`/doctors/${doctor.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return apiFetch("/doctors", { method: "POST", body: JSON.stringify({ email: form.email, firstName: form.firstName, lastName: form.lastName, dni: form.dni || undefined, licenseNumber: form.licenseNumber || undefined, centerIds: form.centerIds, password: form.password }) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["doctors"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  async function uploadSignature(file: File | undefined) {
    if (!file || !doctor) return;
    setError(null);
    const token = getAccessToken();
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/proxy/doctors/${doctor.id}/signature`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    if (!res.ok) { setError("No se pudo subir la firma (PNG/JPG/WEBP)"); return; }
    setHasSig(true); setSigRefresh((n) => n + 1);
    void queryClient.invalidateQueries({ queryKey: ["doctors"] });
  }
  async function removeSignature() {
    if (!doctor) return;
    const token = getAccessToken();
    await fetch(`/api/proxy/doctors/${doctor.id}/signature`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    setHasSig(false); setSigRefresh((n) => n + 1);
    void queryClient.invalidateQueries({ queryKey: ["doctors"] });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? "Editar médico" : "Nuevo médico"}</h2>
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
          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                <input type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña *</label>
                <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}
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

          {isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Firma del médico</label>
              <div className="flex items-center gap-3">
                <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 min-w-[110px] flex items-center justify-center">
                  {hasSig ? <SignatureImg doctorId={doctor.id} refresh={sigRefresh} /> : <span className="text-xs text-gray-400">Sin firma</span>}
                </div>
                {hasSig ? (
                  <button type="button" onClick={() => void removeSignature()} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">× Quitar</button>
                ) : (
                  <label className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 cursor-pointer">
                    Subir firma
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void uploadSignature(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>
          )}

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

export default function DoctorsPage() {
  const [showNew, setShowNew] = useState(false);
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null);
  const [search, setSearch] = useState("");
  const [centerFilter, setCenterFilter] = useState("");

  const { data: doctors, isLoading } = useQuery<Doctor[]>({ queryKey: ["doctors"], queryFn: () => apiFetch<Doctor[]>("/doctors") });
  const { data: centers } = useQuery<Center[]>({ queryKey: ["centers"], queryFn: () => apiFetch<Center[]>("/centers") });
  const { data: tenant } = useQuery<Tenant>({ queryKey: ["tenant-me"], queryFn: () => apiFetch<Tenant>("/tenants/me") });
  const activeCenters = (centers ?? []).filter((c) => c.active);

  const visible = (doctors ?? []).filter((d) => {
    const matchesName = `${d.firstName} ${d.lastName}`.toLowerCase().includes(search.toLowerCase());
    const matchesCenter = !centerFilter || d.centers.some((c) => c.id === centerFilter);
    return matchesName && matchesCenter;
  });

  return (
    <div className="p-6 max-w-6xl">
      {showNew && <DoctorModal centers={activeCenters} onClose={() => setShowNew(false)} />}
      {editDoctor && <DoctorModal doctor={editDoctor} centers={activeCenters} onClose={() => setEditDoctor(null)} />}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Médicos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestión de médicos y sus centros asignados</p>
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">+ Nuevo médico</button>
      </div>

      <div className="flex gap-3 mb-5">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre..." className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={centerFilter} onChange={(e) => setCenterFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos los centros</option>
          {activeCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Empresa</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">DNI</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nº Colegiado</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Centros asignados</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Firma</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
            {!isLoading && visible.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin médicos</td></tr>}
            {visible.map((d) => (
              <tr key={d.id} className={`hover:bg-gray-50 ${!d.active ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 text-gray-500">{tenant?.name ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{d.firstName} {d.lastName}</td>
                <td className="px-4 py-3 text-gray-600 tabular-nums">{d.dni ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600 tabular-nums">{d.licenseNumber ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{d.centers.length ? d.centers.map((c) => c.name).join(", ") : "—"}</td>
                <td className="px-4 py-3">{d.hasSignature ? <SignatureImg doctorId={d.id} refresh={0} /> : <span className="text-xs text-gray-400">Sin firma</span>}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${d.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{d.active ? "Activo" : "Inactivo"}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEditDoctor(d)} className="text-gray-400 hover:text-blue-600 px-2" aria-label="Editar">✎</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
