"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface CreatedCustomer {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

interface NewCustomerForm {
  firstName: string; lastName: string; email: string; phone: string; dni: string;
  birthDate: string; nationality: string; municipality: string; province: string;
  gdprConsent: boolean;
}

const EMPTY_FORM: NewCustomerForm = {
  firstName: "", lastName: "", email: "", phone: "",
  dni: "", birthDate: "", nationality: "", municipality: "", province: "",
  gdprConsent: false,
};

// Modal de alta de cliente. Reutilizable: `onCreated` recibe el cliente creado
// (para, p.ej., seleccionarlo automáticamente en una reserva).
export function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (c: CreatedCustomer) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewCustomerForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<CreatedCustomer>("/customers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onCreated?.(created);
      onClose();
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "errors" in err) {
        const e = err as { errors: Array<{ message?: string; code?: string }> | Record<string, string[]> };
        if (Array.isArray(e.errors)) setError(e.errors[0]?.message ?? "Error al crear el cliente");
        else setError(Object.values(e.errors).flat()[0] ?? "Error al crear el cliente");
      } else {
        setError(err instanceof Error ? err.message : "Error al crear el cliente");
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.gdprConsent) {
      setError("Debes confirmar que has informado al cliente sobre el tratamiento de sus datos (RGPD)");
      return;
    }
    if (!form.email && !form.phone) {
      setError("Indica al menos un email o un teléfono");
      return;
    }
    const body: Record<string, unknown> = {
      dni: form.dni,
      gdprInformedAt: new Date().toISOString(),
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nuevo cliente</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {textField("DNI / NIE", "dni", "text", true)}
            {textField("Fecha de nacimiento", "birthDate", "date", true)}
            {textField("Nombre", "firstName", "text", true)}
            {textField("Apellidos", "lastName", "text", true)}
            {textField("Email", "email", "email")}
            {textField("Teléfono", "phone", "tel")}
            {textField("Municipio", "municipality", "text", true)}
            {textField("Provincia", "province", "text", true)}
          </div>
          {textField("Nacionalidad", "nationality", "text", true)}

          <label className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={form.gdprConsent}
              onChange={(e) => setForm((f) => ({ ...f, gdprConsent: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-xs text-amber-800 leading-snug">
              He informado al cliente sobre el tratamiento de sus datos personales según el RGPD.
              <span className="block text-amber-600 mt-0.5">El consentimiento firmado se registra después, en la pestaña RGPD del cliente.</span>
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
