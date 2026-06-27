"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";

type Role = "ADMIN" | "RECEPTIONIST" | "DOCTOR";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin Cliente",
  RECEPTIONIST: "BackOffice Centro",
  DOCTOR: "Médico",
};
const ROLES = Object.keys(ROLE_LABELS) as Role[];

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl">×</button>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? "Editar usuario" : "Nuevo usuario"}</h2>
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
            <input type="email" required disabled={isEdit} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol *</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {showCenter && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Centro {form.role === "RECEPTIONIST" ? "(verá solo este centro)" : "(opcional)"}</label>
              <select value={form.centerId} onChange={(e) => setForm((f) => ({ ...f, centerId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Sin asignar (todos) —</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{isEdit ? "Nueva contraseña (opcional)" : "Contraseña *"}</label>
            <input type="password" required={!isEdit} minLength={8} value={form.password} placeholder={isEdit ? "Dejar en blanco para no cambiar" : ""}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? "Guardando..." : isEdit ? "Guardar" : "Crear usuario"}
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

  const { data: users, isLoading } = useQuery<TeamUser[]>({ queryKey: ["users"], queryFn: () => apiFetch<TeamUser[]>("/users") });
  const { data: centers } = useQuery<Center[]>({ queryKey: ["centers"], queryFn: () => apiFetch<Center[]>("/centers") });
  const activeCenters = (centers ?? []).filter((c) => c.active);

  const toggle = useMutation({
    mutationFn: (u: TeamUser) => apiFetch(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  function roleBadge(role: Role) {
    const cls = role === "ADMIN" ? "bg-purple-50 text-purple-700" : role === "RECEPTIONIST" ? "bg-blue-50 text-blue-700" : "bg-teal-50 text-teal-700";
    return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{ROLE_LABELS[role]}</span>;
  }

  return (
    <div className="p-6 max-w-5xl">
      {showNew && <UserModal centers={activeCenters} onClose={() => setShowNew(false)} />}
      {editUser && <UserModal user={editUser} centers={activeCenters} onClose={() => setEditUser(null)} />}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Equipo</h1>
          <p className="text-sm text-gray-500 mt-0.5">Usuarios del backoffice: admins, BackOffice por centro y médicos</p>
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">+ Nuevo usuario</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Rol</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Centro</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>}
            {!isLoading && (!users || users.length === 0) && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin usuarios</td></tr>}
            {users?.map((u) => (
              <tr key={u.id} className={`hover:bg-gray-50 ${!u.active ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{u.firstName} {u.lastName}</td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3">{roleBadge(u.role)}</td>
                <td className="px-4 py-3 text-gray-600">{u.center?.name ?? <span className="text-gray-400">Todos</span>}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{u.active ? "Activo" : "Inactivo"}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => toggle.mutate(u)} disabled={toggle.isPending} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">{u.active ? "Desactivar" : "Activar"}</button>
                    <button onClick={() => setEditUser(u)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">Editar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
