import { z } from "zod";

// Tipos de campo soportados por el renderer dinámico (apps/web revisión).
export const FIELD_TYPES = ["text", "number", "boolean", "select", "textarea", "date"] as const;

export const formFieldSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "name debe ser un identificador válido"),
  label: z.string().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional().default(false),
  options: z.array(z.string().min(1)).optional(),
  unit: z.string().max(20).optional(),
});

export type FormField = z.infer<typeof formFieldSchema>;

export const formFieldsSchema = z.array(formFieldSchema).min(1).max(100);

// Validación cruzada del schema de formulario (tarea 7.2): nombres únicos y
// que los campos select tengan opciones. Pura y testeable.
export function validateFormFields(
  fields: { name: string; type: string; options?: string[] | undefined }[],
): string | null {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) return `Campo duplicado: "${f.name}"`;
    seen.add(f.name);
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      return `El campo "${f.name}" (lista) requiere al menos una opción`;
    }
  }
  return null;
}
