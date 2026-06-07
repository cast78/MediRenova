"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  nationality: string | null;
  municipality: string | null;
  province: string | null;
  notes: string | null;
  gdprConsentAt: string | null;
  createdAt: string;
}

interface Revision {
  id: string;
  outcome: string;
  expiryDate: string | null;
  completedAt: string | null;
  createdAt: string;
  appointment: {
    scheduledAt: string;
    product: { name: string };
  };
  doctor: { id: string; firstName: string; lastName: string } | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  PENDING: "En curso",
  APTO: "Apto",
  NO_APTO: "No apto",
  APTO_CON_RESTRICCIONES: "Apto c/ restricciones",
};

const OUTCOME_COLORS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  APTO: "bg-green-50 text-green-700",
  NO_APTO: "bg-red-50 text-red-700",
  APTO_CON_RESTRICCIONES: "bg-blue-50 text-blue-700",
};

type EditForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: string;
  nationality: string;
  municipality: string;
  province: string;
  notes: string;
};

function toEditForm(c: Customer): EditForm {
  return {
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    birthDate: c.birthDate ? c.birthDate.slice(0, 10) : "",
    nationality: c.nationality ?? "",
    municipality: c.municipality ?? "",
    province: c.province ?? "",
    notes: c.notes ?? "",
  };
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500 w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value ?? "—"}</span>
    </div>
  );
}

function EditField({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: customer, isLoading: loadingCustomer } = useQuery<Customer>({
    queryKey: ["customer", id],
    queryFn: () => apiFetch<Customer>(`/customers/${id}`),
  });

  const { data: revisions, isLoading: loadingRevisions } = useQuery<Revision[]>({
    queryKey: ["customer-revisions", id],
    queryFn: () => apiFetch<Revision[]>(`/customers/${id}/revisions`),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Partial<EditForm> & { birthDate?: string }) =>
      apiFetch(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
      setEditing(false);
      setEditError(null);
    },
    onError: (err: unknown) => {
      setEditError(err instanceof Error ? err.message : "Error al guardar");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push("/customers");
    },
  });

  function startEdit() {
    if (customer) { setEditForm(toEditForm(customer)); setEditing(true); setEditError(null); }
  }

  function cancelEdit() { setEditing(false); setEditForm(null); setEditError(null); }

  function saveEdit() {
    if (!editForm) return;
    const body: Record<string, string> = {};
    const keys: (keyof EditForm)[] = ["firstName", "lastName", "email", "phone", "nationality", "municipality", "province", "notes"];
    keys.forEach((k) => { if (editForm[k]) body[k] = editForm[k]; });
    if (editForm.birthDate) body["birthDate"] = new Date(editForm.birthDate).toISOString();
    updateMutation.mutate(body);
  }

  function setField(key: keyof EditForm) {
    return (v: string) => setEditForm((f) => f ? { ...f, [key]: v } : f);
  }

  if (loadingCustomer) return <div className="p-6 text-gray-400 text-sm">Cargando...</div>;
  if (!customer) return <div className="p-6 text-red-500 text-sm">Cliente no encontrado</div>;

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Volver</button>
          <h1 className="text-xl font-semibold text-gray-900">
            {customer.firstName} {customer.lastName}
          </h1>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <button
                onClick={startEdit}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Editar
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-800 font-medium mb-1">¿Eliminar este cliente?</p>
          <p className="text-xs text-red-600 mb-3">
            Se anonimizarán todos sus datos personales (RGPD). Las revisiones se conservan para auditoría.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Confirmar eliminación"}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Personal data */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-gray-900">Datos personales</h2>
          {editing && (
            <div className="flex gap-2">
              <button onClick={cancelEdit} className="px-3 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50">Cancelar</button>
              <button onClick={saveEdit} disabled={updateMutation.isPending} className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {updateMutation.isPending ? "Guardando..." : "Guardar"}
              </button>
            </div>
          )}
        </div>

        {editing && editForm ? (
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Nombre" value={editForm.firstName} onChange={setField("firstName")} />
            <EditField label="Apellidos" value={editForm.lastName} onChange={setField("lastName")} />
            <EditField label="Email" value={editForm.email} onChange={setField("email")} type="email" />
            <EditField label="Teléfono" value={editForm.phone} onChange={setField("phone")} type="tel" />
            <EditField label="Fecha de nacimiento" value={editForm.birthDate} onChange={setField("birthDate")} type="date" />
            <EditField label="Nacionalidad" value={editForm.nationality} onChange={setField("nationality")} />
            <EditField label="Municipio" value={editForm.municipality} onChange={setField("municipality")} />
            <EditField label="Provincia" value={editForm.province} onChange={setField("province")} />
            <div className="col-span-2">
              <EditField label="Notas" value={editForm.notes} onChange={setField("notes")} />
            </div>
            {editError && <p className="col-span-2 text-sm text-red-600">{editError}</p>}
          </div>
        ) : (
          <>
            <InfoRow label="Email" value={customer.email} />
            <InfoRow label="Teléfono" value={customer.phone} />
            <InfoRow label="Fecha de nacimiento" value={customer.birthDate ? new Date(customer.birthDate).toLocaleDateString("es-ES") : null} />
            <InfoRow label="Nacionalidad" value={customer.nationality} />
            <InfoRow label="Municipio" value={customer.municipality} />
            <InfoRow label="Provincia" value={customer.province} />
            <InfoRow label="Consentimiento GDPR" value={customer.gdprConsentAt ? new Date(customer.gdprConsentAt).toLocaleString("es-ES") : "No registrado"} />
            <InfoRow label="Alta en sistema" value={new Date(customer.createdAt).toLocaleDateString("es-ES")} />
            {customer.notes && <InfoRow label="Notas" value={customer.notes} />}
          </>
        )}
      </div>

      {/* Revision history */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Historial de revisiones</h2>
          <span className="text-xs text-gray-400">{revisions?.length ?? 0} revisiones</span>
        </div>

        {loadingRevisions && <p className="px-5 py-6 text-gray-400 text-sm">Cargando...</p>}

        {!loadingRevisions && (!revisions || revisions.length === 0) && (
          <p className="px-5 py-6 text-gray-400 text-sm text-center">Sin revisiones registradas</p>
        )}

        <div className="divide-y divide-gray-50">
          {revisions?.map((rev) => (
            <div key={rev.id} className="px-5 py-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {rev.appointment.product.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(rev.appointment.scheduledAt).toLocaleDateString("es-ES")}
                  {rev.doctor && ` · Dr. ${rev.doctor.firstName} ${rev.doctor.lastName}`}
                </p>
                {rev.expiryDate && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Caduca: {new Date(rev.expiryDate).toLocaleDateString("es-ES")}
                  </p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${OUTCOME_COLORS[rev.outcome] ?? "bg-gray-100 text-gray-600"}`}>
                {OUTCOME_LABELS[rev.outcome] ?? rev.outcome}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

