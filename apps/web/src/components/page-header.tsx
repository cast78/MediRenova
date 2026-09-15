import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck, DoorOpen, Activity, ClipboardList, Users, Megaphone, Zap,
  Building2, Package, FileText, Stethoscope, UserCog, Settings,
} from "lucide-react";

// Cabecera de sección reutilizable: icono de marca (badge en gradiente) + título +
// subtítulo. Da contexto y aire, y unifica el encabezado de todas las páginas.
const PAGES = {
  reservas: { icon: CalendarCheck, title: "Reservas", subtitle: "Gestiona las citas de tus pacientes" },
  visitas: { icon: DoorOpen, title: "Visitas", subtitle: "Pacientes presentes en el centro" },
  consulta: { icon: Activity, title: "Consulta", subtitle: "Cabina del médico" },
  revisiones: { icon: ClipboardList, title: "Revisiones médicas", subtitle: "Reconocimientos y certificados" },
  clientes: { icon: Users, title: "Clientes", subtitle: "Tu base de pacientes" },
  campanas: { icon: Megaphone, title: "Campañas", subtitle: "Comunicación comercial con tus clientes" },
  workflow: { icon: Zap, title: "Workflow", subtitle: "Automatización de avisos" },
  centros: { icon: Building2, title: "Centros", subtitle: "Tus centros y salas" },
  productos: { icon: Package, title: "Productos", subtitle: "Servicios y reconocimientos" },
  formularios: { icon: FileText, title: "Formularios", subtitle: "Plantillas de exploración" },
  medicos: { icon: Stethoscope, title: "Médicos", subtitle: "El equipo médico" },
  equipo: { icon: UserCog, title: "Equipo", subtitle: "Usuarios y permisos" },
  configuracion: { icon: Settings, title: "Configuración", subtitle: "Ajustes del centro" },
} satisfies Record<string, { icon: LucideIcon; title: string; subtitle: string }>;

export function PageHeader({ page }: { page: keyof typeof PAGES }) {
  const p = PAGES[page];
  const Icon = p.icon;
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center shadow-sm shrink-0">
        <Icon className="w-5 h-5" strokeWidth={2} />
      </div>
      <div>
        <h1 className="text-xl font-bold text-gray-900 leading-tight">{p.title}</h1>
        <p className="text-sm text-gray-500">{p.subtitle}</p>
      </div>
    </div>
  );
}
