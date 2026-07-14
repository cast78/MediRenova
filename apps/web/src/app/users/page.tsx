"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Search, UserPlus, Pencil, CheckCircle2, Ban, Building2, X, UserCog, ShieldCheck, Headset, Stethoscope } from "lucide-react";

type Role = "ADMIN" | "RECEPTIONIST" | "DOCTOR";

const ROLE_META: Record<Role, { label: string; chip: string; icon: typeof ShieldCheck }> = {
  ADMIN: { label: "Admin Cliente", chip: "bg-purple-50 text-purple-700", icon: ShieldCheck },
  RECEPTIONIST: { label: "BackOffice Centro", chip: "bg-blue-50 text-blue-700", icon: Headset },
  DOCTOR: { label: "Médico", chip: "bg-teal-50 text-teal-700", icon: Stethoscope },
};
const ROLES = Object.keys(ROLE_META) as Role[];

interface TeamUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  centerId: string | null;
  active: boolean;
  center: { id: string; name: string } | null;
}

interface Center {
  id: string;
  name: string;
  active: boolean;
}

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

// ── Modal ───────────────────────────────────────────────────────────────────────

interface UserForm {
  email: string; firstName: string; lastName: string; role: Role; centerId: string; password: string;
}

function UserModal({ user, centers, onClose }: { user?: TeamUser; centers: Center[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isEdit = !!user;
  const [form, setForm] = useState<UserForm>(
    user
      ? { email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, centerId: user.centerId ?? "", password: "" }
      : { email: "", firstName: "", lastName: "", role: "RECEPTIONIST", centerId: "", password: "" },
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const centerId = form.centerId || null;
      if (isEdit) {
        const body: Record<string, unknown> = { firstName: form.firstName, lastName: form.lastName, role: form.role, centerId };
        if (form.password) body["password"] = form.password;
        return apiFetch(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return apiFetch("/users", { method: "POST", body: JSON.stringify({ email: form.email, firstName: form.firstName, lastName: form.lastName, role: form.role, centerId, password: form.password }) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["users"] }); onClose(); },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  const showCenter = form.role !== "ADMIN";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} aria-label="Cerrar" className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-3 mb-4">
          <span className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0"><UserCog className="w-[18px] h-[18px] text-blue-600" /></span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">{isEdit ? "Editar usuario" : "Nuevo usuario"}</h2>
            <p className="text-xs text-gray-400">{isEdit ? "Datos, rol y acceso" : "Alta de un miembro del equipo"}</p>
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
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
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email {isEdit ? "" : "*"}</label>
            <input type="email" required={!isEdit} disabled={isEdit} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? "bg-gray-50 text-gray-500 cursor-not-allowed" : ""}`} />
            {isEdit && <p className="text-[11px] text-gray-400 mt-1">El email de acceso no se cambia aquí.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol *</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
          </div>
          {showCenter && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Centro {form.role === "RECEPTIONIST" ? "(verá solo este centro)" : "(opcional)"}</label>
              <select value={form.centerId} onChange={(e) => setForm((f) => ({ ...f, centerId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Sin asignar (todos) —</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{isEdit ? "Nueva contraseña" : "Contraseña *"}</label>
            <input type="password" required={!isEdit} minLength={8} value={form.password} placeholder={isEdit ? "Dejar en blanco para no cambiar" : ""}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {isEdit && <p className="text-[11px] text-gray-400 mt-1">Mínimo 8 caracteres si la cambias.</p>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium">
              {mutation.isPending ? "Guardando…" : isEdit ? "Guardar" : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editUser, setEditUser] = useState<TeamUser | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");

  const { data: users, isLoading } = useQuery<TeamUser[]>({ queryKey: ["users"], queryFn: () => apiFetch<TeamUser[]>("/users") });
  const { data: centers } = useQuery<Center[]>({ queryKey: ["centers"], queryFn: () => apiFetch<Center[]>("/centers") });
  const activeCenters = (centers ?? []).filter((c) => c.active);

  const toggle = useMutation({
    mutationFn: (u: TeamUser) => apiFetch(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const visible = (users ?? []).filter((u) => {
    const needle = search.trim().toLowerCase();
    const matchesText = !needle || `${u.firstName} ${u.lastName}`.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle);
    const matchesRole = !roleFilter || u.role === roleFilter;
    return matchesText && matchesRole;
  });

  return (
    <div className="p-6 max-w-5xl">
      {showNew && <UserModal centers={activeCenters} onClose={() => setShowNew(false)} />}
      {editUser && <UserModal user={editUser} centers={activeCenters} onClose={() => setEditUser(null)} />}

      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Equipo</h1>
          <p className="text-sm text-gray-500 mt-0.5">Usuarios del backoffice: admins, BackOffice por centro y médicos</p>
        </div>
        <button onClick={() => setShowNew(true)} className="px-3.5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium inline-flex items-center gap-1.5 shrink-0">
          <UserPlus className="w-4 h-4" /> Nuevo usuario
        </button>
      </div>

      <div className="flex gap-2.5 mb-5 flex-wrap">
        <div className="relative w-64 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o email…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "" | Role)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos los roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Usuario</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Rol</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Centro</th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wide">Estado</th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>}
            {!isLoading && visible.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin usuarios</td></tr>}
            {visible.map((u) => {
              const rm = ROLE_META[u.role];
              const RoleIcon = rm.icon;
              const fullName = `${u.firstName} ${u.lastName}`.trim();
              return (
                <tr key={u.id} onClick={() => setEditUser(u)}
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${!u.active ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${rm.chip}`} title={rm.label}><RoleIcon className="w-4 h-4" /></span>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900">{fullName}</div>
                        <div className="text-[11px] text-gray-400 truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rm.chip}`}>{rm.label}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.center?.name
                      ? <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"><Building2 className="w-3 h-3 text-gray-400" />{u.center.name}</span>
                      : <span className="text-gray-400 text-xs">Todos</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {u.active
                      ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />Activo</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Inactivo</span>}
                  </td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 justify-end">
                      {u.active ? (
                        <button onClick={() => toggle.mutate(u)} disabled={toggle.isPending} title="Desactivar usuario"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          <Ban className="w-3.5 h-3.5" />Desactivar
                        </button>
                      ) : (
                        <button onClick={() => toggle.mutate(u)} disabled={toggle.isPending} title="Activar usuario"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />Activar
                        </button>
                      )}
                      <button onClick={() => setEditUser(u)} title="Editar" aria-label="Editar"
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
