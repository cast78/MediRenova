"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

interface NewCustomerForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dni: string;
  birthDate: string;
}

const EMPTY_FORM: NewCustomerForm = { firstName: "", lastName: "", email: "", phone: "", dni: "", birthDate: "" };

function NewCustomerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewCustomerForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch("/customers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al crear el cliente");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, string> = { dni: form.dni };
    if (form.firstName) body["firstName"] = form.firstName;
    if (form.lastName) body["lastName"] = form.lastName;
    if (form.email) body["email"] = form.email;
    if (form.phone) body["phone"] = form.phone;
    if (form.birthDate) body["birthDate"] = new Date(form.birthDate).toISOString();
    mutation.mutate(body);
  }

  function field(label: string, key: keyof NewCustomerForm, type = "text", required = false) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && " *"}</label>
        <input
          type={type}
          required={required}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nuevo cliente</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {field("DNI / NIE", "dni", "text", true)}
          {field("Nombre", "firstName")}
          {field("Apellidos", "lastName")}
          {field("Email", "email", "email")}
          {field("Teléfono", "phone", "tel")}
          {field("Fecha de nacimiento", "birthDate", "date")}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? "Guardando..." : "Crear cliente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  const queryParams = new URLSearchParams({ page: String(page), limit: "20" });
  if (q) queryParams.set("q", q);

  const { data, isLoading } = useQuery<{
    data: Customer[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["customers", q, page],
    queryFn: () => apiFetch(`/customers?${queryParams.toString()}`, { raw: true }),
  });

  return (
    <div className="p-6">
      {showModal && <NewCustomerModal onClose={() => setShowModal(false)} />}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Clientes</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          + Nuevo cliente
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre, email o teléfono..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          className="flex-1 max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Teléfono</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Alta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
            )}
            {!isLoading && (!data?.data || data.data.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Sin clientes</td></tr>
            )}
            {data?.data.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/customers/${c.id}`)}>
                <td className="px-4 py-3 font-medium text-gray-900">{c.firstName} {c.lastName}</td>
                <td className="px-4 py-3 text-gray-600">{c.email ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{c.phone ?? "—"}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString("es-ES")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {data && data.meta.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-sm text-gray-500">{data.meta.total} clientes</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
              <button onClick={() => setPage((p) => Math.min(data.meta.pages, p + 1))} disabled={page === data.meta.pages} className="px-3 py-1.5 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

