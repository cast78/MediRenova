// Validación de completitud de una revisión antes de finalizarla (pura, testeable).
// Reglas: formulario con campos definidos, campos obligatorios rellenos, notas
// clínicas y firma del paciente. Devuelve la lista de lo que falta (vacía = OK).

export interface RevFieldDef {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
}

export function missingForCompletion(params: {
  fields: RevFieldDef[];
  formData: Record<string, unknown>;
  attachmentFieldIds: string[]; // fieldIds que tienen al menos un adjunto
  notes: string | null | undefined;
}): string[] {
  const { fields, formData, attachmentFieldIds, notes } = params;
  const has = new Set(attachmentFieldIds);
  const missing: string[] = [];

  if (fields.length === 0) {
    missing.push("No hay un formulario con campos definidos para este producto");
  }

  for (const f of fields) {
    if (!f.required) continue;
    const label = f.label || f.name;
    if (f.type === "image") {
      if (!has.has(f.name)) missing.push(`${label} (imagen)`);
    } else if (f.type === "boolean") {
      // Un checkbox siempre tiene valor (sí/no); no se considera "vacío".
      continue;
    } else {
      const v = formData[f.name];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) missing.push(label);
    }
  }

  if (!notes || !notes.trim()) missing.push("Notas clínicas");
  if (!has.has("signature")) missing.push("Firma del paciente");

  return missing;
}
