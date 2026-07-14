// Formulario de exploración POR DEFECTO del sistema (tomado del de "Carnet de
// Conducir (A/B/B+E)"). Se usa cuando un producto no tiene formulario propio (o lo
// tiene vacío), para que ninguna revisión llegue sin campos de exploración.
export interface DefaultFormField { name: string; type: string; label: string; required: boolean }

export const DEFAULT_EXPLORATION_FORM_FIELDS: DefaultFormField[] = [
  { name: "tension", type: "text", label: "Tensión arterial", required: true },
  { name: "vista", type: "text", label: "Vista", required: true },
  { name: "manejo_volante", type: "text", label: "Manejo de volante", required: true },
  { name: "oido", type: "text", label: "Oído", required: true },
  { name: "espirometria", type: "image", label: "Espirometría", required: true },
];

export const DEFAULT_EXPLORATION_FORM = { fields: DEFAULT_EXPLORATION_FORM_FIELDS };
