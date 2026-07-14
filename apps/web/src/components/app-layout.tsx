"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, getActAsTenant, setActAsTenant } from "@/lib/api";
import { ContextBarProvider, ContextBar } from "@/components/context-bar";

interface Branding { name: string; logoUrl: string | null; primaryColor: string; secondaryColor: string }
import {
  LayoutDashboard,
  CalendarCheck,
  DoorOpen,
  Users,
  Building2,
  Package,
  ClipboardList,
  Activity,
  Zap,
  Megaphone,
  Settings,
  FileText,
  UserCog,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Prefijo alternativo para el resaltado (por defecto = href). */
  match?: string;
  /** Roles que ven el ítem (SUPERADMIN siempre lo ve). Sin roles = todos. */
  roles?: string[];
}

// Perfiles: recepción (agenda/clientes/visitas), médico (visitas + revisiones),
// admin (todo). El menú se filtra por rol para no mostrar lo que daría 403.
const RECEPCION = ["ADMIN", "RECEPTIONIST"];
const CLINICO = ["ADMIN", "RECEPTIONIST", "DOCTOR"];

interface NavSection {
  /** Cabecera de la sección (sin título = grupo principal, sin cabecera). */
  title?: string;
  items: NavItem[];
}

// Menú agrupado. La cabecera de cada sección solo se pinta si el perfil tiene ≥1
// ítem visible dentro (así médico/recepción ven un menú corto y sin títulos vacíos).
const navSections: NavSection[] = [
  {
    // Operación (día a día), ordenado por el flujo del paciente:
    // reservar → llegada/sala → atención → resultado → ficha/seguimiento.
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: RECEPCION },
      { href: "/appointments", label: "Reservas", icon: CalendarCheck, roles: RECEPCION },
      // Landing de Visitas = Gestión (tablero en vivo); resalta en todo /visits.
      { href: "/visits", label: "Visitas", icon: DoorOpen, match: "/visits", roles: RECEPCION },
      // Consulta = cabina del médico (su lista de trabajo del día); primer ítem para él.
      { href: "/consulta", label: "Consulta", icon: Activity, roles: ["DOCTOR"] },
      { href: "/revisions", label: "Revisiones", icon: ClipboardList, roles: CLINICO },
      { href: "/customers", label: "Clientes", icon: Users, roles: RECEPCION },
    ],
  },
  {
    title: "Comunicación",
    items: [
      { href: "/campaigns", label: "Campañas", icon: Megaphone, roles: ["ADMIN"] },
      { href: "/workflow", label: "Workflow", icon: Zap, roles: ["ADMIN"] },
    ],
  },
  {
    // Toda la configuración del negocio en un sitio: catálogo/servicio, personas, ajustes.
    title: "Administración",
    items: [
      { href: "/centers", label: "Centros", icon: Building2, roles: ["ADMIN"] },
      { href: "/products", label: "Productos", icon: Package, roles: ["ADMIN"] },
      { href: "/forms", label: "Formularios", icon: FileText, roles: ["ADMIN"] },
      { href: "/doctors", label: "Médicos", icon: Stethoscope, roles: ["ADMIN"] },
      { href: "/users", label: "Equipo", icon: UserCog, roles: ["ADMIN"] },
      { href: "/settings", label: "Configuración", icon: Settings, roles: ["ADMIN"] },
    ],
  },
];

interface TenantOption { id: string; name: string; slug: string }

// Selector de empresa para SUPERADMIN: "actuar como" un tenant. Guarda la elección
// (la lee apiFetch para mandar `x-act-as-tenant`) y recarga para refrescar todo.
function TenantSwitcher() {
  const [selected, setSelected] = useState<string>("");
  useEffect(() => { setSelected(getActAsTenant() ?? ""); }, []);

  const { data: tenants } = useQuery<TenantOption[]>({
    queryKey: ["admin-tenants"],
    queryFn: () => apiFetch<TenantOption[]>("/admin/tenants"),
    staleTime: 5 * 60_000,
  });

  function onChange(id: string) {
    setActAsTenant(id || null);
    window.location.reload();
  }

  return (
    <div className="px-4 py-3 border-b border-gray-200 bg-amber-50/60">
      <label className="block text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-1">Empresa (superadmin)</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
      >
        <option value="">— Selecciona empresa —</option>
        {(tenants ?? []).filter((t) => t.slug !== "system").map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const { data: branding } = useQuery<Branding>({
    queryKey: ["branding"],
    queryFn: () => apiFetch<Branding>("/tenants/me/branding"),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const primary = branding?.primaryColor ?? "#2563eb";

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.name} className="h-7 max-w-[170px] object-contain" />
          ) : (
            <span className="font-bold text-lg" style={{ color: primary }}>{branding?.name ?? "MediRenova"}</span>
          )}
        </div>

        {user.role === "SUPERADMIN" && <TenantSwitcher />}

        <nav className="flex-1 p-3 overflow-y-auto">
          {navSections.map((section, si) => {
            const items = section.items.filter((item) => !item.roles || user.role === "SUPERADMIN" || item.roles.includes(user.role));
            if (items.length === 0) return null;
            return (
              <div key={section.title ?? `main-${si}`} className={si > 0 ? "pt-3" : ""}>
                {section.title && <p className="text-[11px] font-medium text-gray-400 px-3 pb-1 uppercase tracking-wide">{section.title}</p>}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = pathname.startsWith(item.match ?? item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href as string}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "font-medium" : "text-gray-600 hover:bg-gray-100"}`}
                        style={active ? { backgroundColor: `${primary}14`, color: primary } : undefined}
                      >
                        <item.icon size={16} strokeWidth={1.75} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${primary}1a`, color: primary }}>
              {(user.firstName?.[0] ?? user.email[0] ?? "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{user.email}</p>
              <p className="text-xs text-gray-400">{user.role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-3 py-2 rounded-lg text-left transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <ContextBarProvider>
          <ContextBar empresaName={branding?.name ?? "MediRenova"} primaryColor={primary} />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </ContextBarProvider>
      </main>
    </div>
  );
}
