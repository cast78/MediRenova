"use client";

import { useState, useEffect } from "react";
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
  nationality: string;
  municipality: string;
  province: string;
  gdprConsent: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(first: string | null, last: string | null) {
  const a = (first ?? "")[0] ?? "";
  const b = (last ?? "")[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

const EMPTY_FORM: NewCustomerForm = {
  firstName: "", lastName: "", email: "", phone: "",
  dni: "", birthDate: "", nationality: "", municipality: "", province: "",
  gdprConsent: false,
};

function NewCustomerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewCustomerForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/customers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "errors" in err) {
        const e = err as { errors: Array<{ message?: string; code?: string }> | Record<string, string[]> };
        if (Array.isArray(e.errors)) {
          setError(e.errors[0]?.message ?? "Error al crear el cliente");
        } else {
          setError(Object.values(e.errors).flat()[0] ?? "Error al crear el cliente");
        }
      } else {
        setError(err instanceof Error ? err.message : "Error al crear el cliente");
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.gdprConsent) {
      setError("Debes registrar el consentimiento GDPR del cliente");
      return;
    }
    const body: Record<string, unknown> = {
      dni: form.dni,
      gdprConsentAt: new Date().toISOString(),
    };
    if (form.firstName) body["firstName"] = form.firstName;
    if (form.lastName) body["lastName"] = form.lastName;
    if (form.email) body["email"] = form.email;
    if (form.phone) body["phone"] = form.phone;
    if (form.birthDate) body["birthDate"] = new Date(form.birthDate).toISOString();
    if (form.nationality) body["nationality"] = form.nationality;
    if (form.municipality) body["municipality"] = form.municipality;
    if (form.province) body["province"] = form.province;
    mutation.mutate(body);
  }

  function textField(label: string, key: keyof NewCustomerForm, type = "text", required = false) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && " *"}</label>
        <input
          type={type}
          required={required}
          value={form[key] as string}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nuevo cliente</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {textField("DNI / NIE", "dni", "text", true)}
            {textField("Fecha de nacimiento", "birthDate", "date")}
            {textField("Nombre", "firstName")}
            {textField("Apellidos", "lastName")}
            {textField("Email", "email", "email")}
            {textField("Teléfono", "phone", "tel")}
            {textField("Municipio", "municipality")}
            {textField("Provincia", "province")}
          </div>
          {textField("Nacionalidad", "nationality")}

          {/* GDPR consent */}
          <label className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={form.gdprConsent}
              onChange={(e) => setForm((f) => ({ ...f, gdprConsent: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-xs text-amber-800 leading-snug">
              El cliente ha dado su consentimiento para el tratamiento de sus datos personales según el RGPD.
            </span>
          </label>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
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
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const queryParams = new URLSearchParams({ page: String(page), limit: "20" });
  if (debouncedQ) queryParams.set("q", debouncedQ);

  const { data, isLoading } = useQuery<{
    data: Customer[];
    meta: { page: number; total: number; pages: number };
  }>({
    queryKey: ["customers", debouncedQ, page],
    queryFn: () => apiFetch(`/customers?${queryParams.toString()}`, { raw: true }),
  });

  const total = data?.meta.total ?? 0;
  const pageData = data?.data ?? [];
  const withEmail = pageData.filter((c) => c.email).length;
  const withPhone = pageData.filter((c) => c.phone).length;

  return (
    <div className="p-6 max-w-5xl">
      {showModal && <NewCustomerModal onClose={() => setShowModal(false)} />}

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
        >
          + Nuevo cliente
        </button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Total clientes</p>
          <p className="text-2xl font-bold text-gray-800">{total}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Con email</p>
          <p className="text-2xl font-bold text-blue-700">{withEmail}</p>
          <p className="text-[10px] text-gray-400">de {pageData.length} en página</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400 font-medium mb-0.5">Con teléfono</p>
          <p className="text-2xl font-bold text-emerald-700">{withPhone}</p>
          <p className="text-[10px] text-gray-400">de {pageData.length} en página</p>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre, apellidos, email o teléfono..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Teléfono</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Alta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              [1,2,3,4].map((i) => (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 animate-pulse">
                      <div className="w-8 h-8 rounded-full bg-gray-100 shrink-0" />
                      <div className="h-3 bg-gray-100 rounded w-32" />
                    </div>
                  </td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-40 animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-24 animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-20 animate-pulse" /></td>
                </tr>
              ))
            )}
            {!isLoading && (!data?.data || data.data.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">
                {debouncedQ ? `Sin resultados para "${debouncedQ}"` : "Sin clientes registrados"}
              </td></tr>
            )}
            {data?.data.map((c) => {
              const fullName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
              const color = avatarColor(fullName);
              const initials = getInitials(c.firstName, c.lastName);
              return (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push(`/customers/${c.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {initials}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{fullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.email ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.phone ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.createdAt).toLocaleDateString("es-ES")}</td>
                </tr>
              );
            })}
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

