"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, getActAsTenant, setActAsTenant, getPreviewPlan, setPreviewPlan } from "@/lib/api";
import { ContextBarProvider, ContextBar } from "@/components/context-bar";
import { useFeatures, PLAN_LABEL, trialTone, trialDaysLeft, type FeatureKey } from "@/lib/use-features";
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
  BarChart3,
  UserPlus,
  HeartPulse,
  LogOut,
  Lock,
  Inbox,
  LogIn,
  Eye,
  type LucideIcon,
} from "lucide-react";

interface Branding { name: string; logoUrl: string | null; primaryColor: string; secondaryColor: string }

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Prefijo alternativo para el resaltado (por defecto = href). */
  match?: string;
  /** Roles que ven el ítem (SUPERADMIN siempre lo ve). Sin roles = todos. */
  roles?: string[];
  /** Función de plan que necesita (crm-planes). Sin ella se muestra con candado, no se oculta. */
  feature?: FeatureKey;
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

// Menú de la clínica, agrupado. La cabecera de cada sección solo se pinta si el
// perfil tiene ≥1 ítem visible dentro (así médico/recepción ven un menú corto).
const clinicSections: NavSection[] = [
  {
    // Landing.
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: RECEPCION },
    ],
  },
  {
    // Operación clínica (día a día), por el flujo del paciente:
    // reservar → llegada/sala → atención → resultado → ficha/seguimiento.
    title: "Operación",
    items: [
      { href: "/appointments", label: "Reservas", icon: CalendarCheck, roles: RECEPCION },
      // Landing de Visitas = tablero en vivo; resalta en todo /visits.
      { href: "/visits", label: "Visitas", icon: DoorOpen, match: "/visits", roles: RECEPCION },
      // Consulta = cabina del médico (su lista de trabajo del día); primer ítem para él.
      { href: "/consulta", label: "Consulta", icon: Activity, roles: ["DOCTOR"] },
      { href: "/revisions", label: "Revisiones", icon: ClipboardList, roles: CLINICO },
      { href: "/customers", label: "Clientes", icon: Users, roles: RECEPCION },
    ],
  },
  {
    // Módulos de gestión (KPIs) para admin/superadmin: analítica operativa y captación.
    title: "Gestión",
    items: [
      { href: "/analitica", label: "Analítica", icon: BarChart3, roles: ["ADMIN"], feature: "analytics_pro" },
      { href: "/captacion", label: "Captación", icon: UserPlus, roles: ["ADMIN"], feature: "captacion" },
    ],
  },
  {
    // Parte comercial: campañas y automatización de retención.
    title: "Comercial",
    items: [
      { href: "/campaigns", label: "Campañas", icon: Megaphone, roles: ["ADMIN"], feature: "campaigns" },
      { href: "/workflow", label: "Workflow", icon: Zap, roles: ["ADMIN"], feature: "workflow" },
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

// Modo proveedor (crm-planes P4b): el SUPERADMIN sin empresa seleccionada ve un
// menú propio y corto, por encima de las clínicas.
const providerSections: NavSection[] = [
  {
    items: [
      { href: "/superadmin/empresas", label: "Empresas", icon: Building2 },
      { href: "/superadmin/empresas?filter=requests", label: "Peticiones", icon: Inbox, match: "?filter=requests" },
    ],
  },
];

// Barra superior del modo empresa: el superadmin está "dentro" de una clínica.
// Dice cuál, su plan y centros; permite "Ver como Pro" y volver al panel.
function SuperadminBar({ tenantName }: { tenantName: string }) {
  const { info } = useFeatures();
  const preview = info?.preview === true;
  function togglePreview(on: boolean) { setPreviewPlan(on ? "PRO" : null); window.location.reload(); }
  function back() { setActAsTenant(null); setPreviewPlan(null); window.location.href = "/superadmin/empresas"; }
  const centers = info ? `${info.centersCount} centro${info.centersCount === 1 ? "" : "s"}` : "";
  // La vista previa solo tiene sentido si la empresa NO es ya Pro (por contrato o prueba).
  const trialDays = trialDaysLeft(info?.trialUntil);
  const trialActive = trialDays != null;
  const canPreview = preview || (info ? info.effectivePlan === "ESSENTIAL" : false);
  const planText = !info ? "" : preview ? `Plan real: ${PLAN_LABEL[info.plan]}` : trialActive ? `Pro en prueba · ${trialDays} día${trialDays === 1 ? "" : "s"}` : `Plan ${PLAN_LABEL[info.effectivePlan]}`;
  // Color de la barra: vista previa azul claro · prueba por días restantes (naranja /
  // ámbar / verde) · Pro contratado azul oscuro · Esencial gris oscuro.
  // Tonos pastel (fondo claro, texto oscuro).
  const bar = preview ? "bg-blue-100 text-blue-900 border-b border-blue-200"
    : trialActive ? trialTone(trialDays).bar
    : info?.effectivePlan === "PRO" ? "bg-sky-50 text-sky-900 border-b border-sky-200"
    : "bg-gray-100 text-gray-800 border-b border-gray-200";
  return (
    <div className={`${bar} px-5 py-2 flex items-center gap-3 flex-wrap text-[13px] min-h-[44px]`}>
      {preview ? (
        <span className="inline-flex items-center gap-2"><Eye className="w-4 h-4" /><b>Vista previa Pro</b> de <b>{tenantName}</b> · nada se guarda</span>
      ) : (
        <span className="inline-flex items-center gap-2"><LogIn className="w-4 h-4 opacity-70" />Estás viendo <b>{tenantName}</b> como superadmin</span>
      )}
      {info && (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs bg-white/70 border border-current/20">
          {planText}{centers ? ` · ${centers}` : ""}
        </span>
      )}
      {canPreview && (
        <label className="ml-auto inline-flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={preview} onChange={(e) => togglePreview(e.target.checked)} className="accent-blue-600 w-4 h-4" />
          {preview ? "Salir de la vista previa" : "Ver como Pro (vista previa)"}
        </label>
      )}
      <button type="button" onClick={back} className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-current/30 bg-white/60 hover:bg-white ${canPreview ? "" : "ml-auto"}`}>Volver al panel</button>
    </div>
  );
}

// Chip de plan para el ADMIN de la clínica (crm-planes P4b): discreto, bajo el
// nombre de la empresa; en prueba muestra los días que quedan con la escala de
// color por días restantes. Lleva a Configuración → Empresa → "Tu plan".
function PlanBadge() {
  const { info } = useFeatures();
  if (!info) return null;
  const days = trialDaysLeft(info.trialUntil);
  const cls = days != null ? trialTone(days).chip : info.effectivePlan === "PRO" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-600 border-gray-200";
  const text = days != null ? `Prueba Pro · ${days} d` : `Plan ${PLAN_LABEL[info.effectivePlan]}`;
  return (
    <Link href="/settings?tab=empresa" title="Ver tu plan" className={`mt-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border hover:opacity-80 ${cls}`}>
      {text}
    </Link>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { has: hasFeature } = useFeatures();
  const router = useRouter();
  const pathname = usePathname();

  // Modo del superadmin: sin empresa seleccionada = proveedor; con ella = empresa.
  // Se lee en cliente (localStorage) tras montar, para no desajustar la hidratación.
  const [ready, setReady] = useState(false);
  const [actAs, setActAs] = useState<string | null>(null);
  const [requestsNav, setRequestsNav] = useState(false);
  useEffect(() => { setActAs(getActAsTenant()); setReady(true); setRequestsNav(window.location.search.includes("filter=requests")); }, [pathname]);
  const isSuper = user?.role === "SUPERADMIN";
  const providerMode = isSuper && ready && !actAs;

  const { data: branding } = useQuery<Branding>({
    queryKey: ["branding"],
    queryFn: () => apiFetch<Branding>("/tenants/me/branding"),
    enabled: !!user && !providerMode,
    staleTime: 5 * 60_000,
  });
  const primary = providerMode ? "#2563eb" : (branding?.primaryColor ?? "#2563eb");

  // Aviso in-app: nº de episodios sin cerrar (badge en "Reservas"). Visible para
  // el personal; se refresca cada minuto.
  const { data: episodesData } = useQuery<{ meta: { total: number } }>({
    queryKey: ["nav-unclosed-episodes"],
    queryFn: () => apiFetch("/appointments/unclosed-episodes", { raw: true }),
    enabled: !!user && ready && !providerMode,
    staleTime: 60_000,
  });
  const episodesCount = episodesData?.meta?.total ?? 0;

  // Badge de peticiones abiertas en el menú del proveedor.
  const { data: openRequests } = useQuery<{ id: string }[]>({
    queryKey: ["superadmin-plan-requests"],
    queryFn: () => apiFetch<{ id: string }[]>("/superadmin/plan-requests?status=OPEN"),
    enabled: !!providerMode,
    staleTime: 60_000,
  });
  const openRequestsCount = openRequests?.length ?? 0;

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  // En modo proveedor solo tienen sentido las páginas /superadmin: el resto redirige.
  useEffect(() => {
    if (providerMode && !pathname.startsWith("/superadmin")) router.replace("/superadmin/empresas");
  }, [providerMode, pathname, router]);

  if (loading || (isSuper && !ready)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) return null;

  const sections = providerMode ? providerSections : clinicSections;
  const isActive = (item: NavItem) => {
    if (item.match === "?filter=requests") return requestsNav;
    if (item.href === "/superadmin/empresas") return pathname.startsWith("/superadmin") && !requestsNav;
    return pathname.startsWith(item.match ?? item.href);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center shadow-sm shrink-0">
              <HeartPulse className="w-5 h-5" strokeWidth={2.2} />
            </div>
            <div className="leading-tight min-w-0">
              <span className="block font-bold text-gray-900 tracking-tight truncate">MediRenova</span>
              {providerMode
                ? <span className="block text-[11px] text-gray-400 truncate">Panel de proveedor</span>
                : branding?.name && <span className="block text-[11px] text-gray-400 truncate">{branding.name}</span>}
            </div>
          </div>
          {providerMode && <span className="mt-2.5 inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-900 text-white uppercase tracking-wide">Modo proveedor</span>}
          {user.role === "ADMIN" && <PlanBadge />}
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          {sections.map((section, si) => {
            const items = section.items.filter((item) => !item.roles || user.role === "SUPERADMIN" || item.roles.includes(user.role));
            if (items.length === 0) return null;
            return (
              <div key={section.title ?? `main-${si}`} className={si > 0 ? "pt-3" : ""}>
                {section.title && <p className="text-[11px] font-medium text-gray-400 px-3 pb-1 uppercase tracking-wide">{section.title}</p>}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = isActive(item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href as string}
                        onClick={() => setRequestsNav(item.match === "?filter=requests")}
                        className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "font-medium" : "text-gray-600 hover:bg-gray-100"}`}
                        style={active ? { backgroundColor: `${primary}14`, color: primary } : undefined}
                      >
                        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full" style={{ backgroundColor: primary }} />}
                        <item.icon size={16} strokeWidth={1.75} />
                        <span className="flex-1">{item.label}</span>
                        {item.feature && !hasFeature(item.feature) && (
                          <Lock size={13} className="text-gray-400" aria-label="Disponible en el plan Pro" />
                        )}
                        {item.href === "/appointments" && episodesCount > 0 && (
                          <span title={`${episodesCount} episodio(s) sin cerrar`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{episodesCount}</span>
                        )}
                        {item.label === "Peticiones" && openRequestsCount > 0 && (
                          <span title={`${openRequestsCount} petición(es) abierta(s)`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">{openRequestsCount}</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-2.5 px-1.5 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
              {(user.firstName?.[0] ?? user.email[0] ?? "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{user.email}</p>
              <p className="text-[11px] text-gray-400">{user.role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-3 py-2 rounded-lg text-left transition-colors"
          >
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {isSuper && actAs && <SuperadminBar tenantName={branding?.name ?? "la empresa"} />}
        {/* El provider siempre envuelve a las páginas (algunas usan useAppContext incluso
            durante el instante previo a la redirección); en modo proveedor solo se
            oculta la barra Empresa › Centro. */}
        <ContextBarProvider>
          {!providerMode && <ContextBar empresaName={branding?.name ?? "MediRenova"} primaryColor={primary} />}
          <div className="flex-1 overflow-y-auto">{children}</div>
        </ContextBarProvider>
      </main>
    </div>
  );
}
