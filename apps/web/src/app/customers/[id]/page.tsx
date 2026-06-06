"use client";

import { useQuery } from "@tanstack/react-query";
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

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500 w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value ?? "—"}</span>
    </div>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: customer, isLoading: loadingCustomer } = useQuery<Customer>({
    queryKey: ["customer", id],
    queryFn: () => apiFetch<Customer>(`/customers/${id}`),
  });

  const { data: revisions, isLoading: loadingRevisions } = useQuery<Revision[]>({
    queryKey: ["customer-revisions", id],
    queryFn: () => apiFetch<Revision[]>(`/customers/${id}/revisions`),
  });

  if (loadingCustomer) {
    return <div className="p-6 text-gray-400 text-sm">Cargando...</div>;
  }

  if (!customer) {
    return <div className="p-6 text-red-500 text-sm">Cliente no encontrado</div>;
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Volver</button>
        <h1 className="text-xl font-semibold text-gray-900">
          {customer.firstName} {customer.lastName}
        </h1>
      </div>

      {/* Personal data */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="font-medium text-gray-900 mb-3">Datos personales</h2>
        <InfoRow label="Email" value={customer.email} />
        <InfoRow label="Teléfono" value={customer.phone} />
        <InfoRow label="Fecha de nacimiento" value={customer.birthDate ? new Date(customer.birthDate).toLocaleDateString("es-ES") : null} />
        <InfoRow label="Nacionalidad" value={customer.nationality} />
        <InfoRow label="Municipio" value={customer.municipality} />
        <InfoRow label="Provincia" value={customer.province} />
        <InfoRow label="Consentimiento GDPR" value={customer.gdprConsentAt ? new Date(customer.gdprConsentAt).toLocaleString("es-ES") : "No registrado"} />
        <InfoRow label="Alta en sistema" value={new Date(customer.createdAt).toLocaleDateString("es-ES")} />
        {customer.notes && <InfoRow label="Notas" value={customer.notes} />}
      </div>

      {/* Revision history */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-medium text-gray-900">Historial de revisiones</h2>
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
