"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, getActAsTenant, setActAsTenant, getPreviewPlan, setPreviewPlan } from "@/lib/api";
import { ContextBarProvider, ContextBar } from "@/components/context-bar";
import { useFeatures, PLAN_LABEL, trialTone, trialDaysLeft, type FeatureKey } from "@/lib/use-features";
import { PlanChip } from "@/components/plan-chip";
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
  Menu,
  X,
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
// Por debajo de lg (tablet vertical, crm-multidispositivo T1) cabe en una línea:
// los textos largos pasan a `title` y el botón de volver se acorta.
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
  const headline = preview ? `Vista previa Pro de ${tenantName} · nada se guarda` : `Estás viendo ${tenantName} como superadmin`;
  return (
    <div className={`${bar} px-3 lg:px-5 py-2 flex items-center gap-2 lg:gap-3 lg:flex-wrap text-[13px] min-h-[44px]`}>
      {preview ? (
        <span className="inline-flex items-center gap-2 min-w-0" title={headline}><Eye className="w-4 h-4 shrink-0" /><span className="truncate"><b>Vista previa Pro</b><span className="hidden lg:inline"> de <b>{tenantName}</b> · nada se guarda</span></span></span>
      ) : (
        <span className="inline-flex items-center gap-2 min-w-0" title={headline}><LogIn className="w-4 h-4 opacity-70 shrink-0" /><span className="truncate"><span className="hidden lg:inline">Estás viendo </span><b>{tenantName}</b><span className="hidden lg:inline"> como superadmin</span></span></span>
      )}
      {info && (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs bg-white/70 border border-current/20 whitespace-nowrap shrink-0" title={centers ? `${planText} · ${centers}` : planText}>
          {planText}<span className="hidden lg:inline">{centers ? ` · ${centers}` : ""}</span>
        </span>
      )}
      {canPreview && (
        <label className="ml-auto inline-flex items-center gap-2 text-xs cursor-pointer whitespace-nowrap shrink-0" title={preview ? "Salir de la vista previa" : "Ver como Pro (vista previa)"}>
          <input type="checkbox" checked={preview} onChange={(e) => togglePreview(e.target.checked)} className="accent-blue-600 w-4 h-4" />
          <span className="hidden lg:inline">{preview ? "Salir de la vista previa" : "Ver como Pro (vista previa)"}</span>
          <span className="lg:hidden">{preview ? "Salir" : "Ver como Pro"}</span>
        </label>
      )}
      <button type="button" onClick={back} title="Volver al panel de proveedor" className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white shadow-sm hover:bg-blue-700 whitespace-nowrap shrink-0 ${canPreview ? "" : "ml-auto"}`}><LogOut className="w-3.5 h-3.5 rotate-180" /> <span className="hidden lg:inline">Volver al panel</span><span className="lg:hidden">Volver</span></button>
    </div>
  );
}

// Chip de plan para el ADMIN de la clínica (crm-planes P4b): discreto, bajo el
// nombre de la empresa; en prueba muestra los días que quedan con la escala de
// color por días restantes. Lleva a Configuración → Empresa → "Tu plan".
function PlanBadge() {
  const { info } = useFeatures();
  if (!info) return null;
  // Mismo chip que en "Tu plan" y en el panel de proveedor (Esencial verde · Pro azul · prueba ámbar).
  return (
    <Link href="/settings?tab=empresa" title="Ver tu plan" className="mt-3 inline-flex items-center gap-1.5 touch:min-h-[44px] hover:opacity-80 transition-opacity">
      <span className="text-[11px] font-medium text-gray-500">Tu plan</span>
      <PlanChip plan={info.effectivePlan} trialDaysLeft={trialDaysLeft(info.trialUntil)} />
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

  // Cajón del menú en tablet vertical (< lg, crm-multidispositivo T1). Se cierra al
  // navegar, al tocar fuera, con Escape o si la ventana pasa a tamaño de escritorio.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = (e: MediaQueryListEvent) => { if (e.matches) setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => { window.removeEventListener("keydown", onKey); mq.removeEventListener("change", onMq); };
  }, [drawerOpen]);

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
  const visibleItems = (section: NavSection) =>
    section.items.filter((item) => !item.roles || user.role === "SUPERADMIN" || item.roles.includes(user.role));
  const initial = (user.firstName?.[0] ?? user.email[0] ?? "U").toUpperCase();

  // --- Piezas del menú, compartidas por el aside de escritorio (≥ lg) y el cajón (< lg) ---

  const brandRow = (
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
  );

  const brandExtras = (
    <>
      {providerMode && <div className="flex justify-center"><span className="mt-4 inline-block text-[9px] font-semibold uppercase tracking-[0.14em] text-blue-700 border-b border-blue-400 pb-0.5">Modo proveedor</span></div>}
      {user.role === "ADMIN" && <div className="flex justify-center"><PlanBadge /></div>}
    </>
  );

  const fullNav = (
    <nav className="flex-1 p-3 overflow-y-auto">
      {sections.map((section, si) => {
        const items = visibleItems(section);
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
                    className={`relative flex items-center gap-2.5 px-3 py-2 touch:py-3 rounded-lg text-sm transition-colors ${active ? "font-medium" : "text-gray-600 hover:bg-gray-100"}`}
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
  );

  const userFooter = (
    <div className="p-3 border-t border-gray-200">
      <div className="flex items-center gap-2.5 px-1.5 mb-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
          {initial}
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
  );

  // Raíl de 64 px (< lg): logo, iconos de módulos con badge y candado, avatar.
  // Tocar un icono navega directamente; el logo y el avatar abren el cajón, que
  // es donde están las etiquetas, el plan, el usuario y "Cerrar sesión".
  const rail = (
    <aside className="flex lg:hidden w-16 shrink-0 bg-white border-r border-gray-200 flex-col items-center">
      <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú" title="Menú" className="mt-3 mb-1 w-11 h-11 rounded-xl inline-flex items-center justify-center hover:bg-gray-100">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center shadow-sm">
          <HeartPulse className="w-5 h-5" strokeWidth={2.2} />
        </span>
      </button>
      <nav className="flex-1 w-full overflow-y-auto py-1 flex flex-col items-center gap-0.5" aria-label="Módulos">
        {sections.map((section, si) => {
          const items = visibleItems(section);
          if (items.length === 0) return null;
          return (
            <div key={section.title ?? `main-${si}`} className="w-full flex flex-col items-center gap-0.5">
              {si > 0 && <span className="w-8 h-px bg-gray-200 my-1.5" aria-hidden />}
              {items.map((item) => {
                const active = isActive(item);
                const locked = !!item.feature && !hasFeature(item.feature);
                const badge = item.href === "/appointments" ? episodesCount : item.label === "Peticiones" ? openRequestsCount : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href as string}
                    onClick={() => setRequestsNav(item.match === "?filter=requests")}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center justify-center w-12 h-12 rounded-xl transition-colors ${active ? "" : "text-gray-600 hover:bg-gray-100"}`}
                    style={active ? { backgroundColor: `${primary}14`, color: primary } : undefined}
                  >
                    {active && <span className="absolute -left-2 top-2 bottom-2 w-1 rounded-full" style={{ backgroundColor: primary }} />}
                    <item.icon size={20} strokeWidth={1.75} />
                    {locked && <Lock size={11} className="absolute bottom-1.5 right-1.5 text-gray-400 bg-white rounded-full" aria-label="Disponible en el plan Pro" />}
                    {badge > 0 && (
                      <span className={`absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 text-center font-semibold ${item.label === "Peticiones" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{badge}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Cuenta y menú" title={user.email} className="mt-1 mb-3 w-11 h-11 rounded-xl inline-flex items-center justify-center hover:bg-gray-100">
        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center text-xs font-bold">{initial}</span>
      </button>
    </aside>
  );

  // Cajón de 280 px sobre el contenido (< lg): el menú completo con etiquetas.
  const drawer = drawerOpen ? (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menú">
      <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
      <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-white shadow-2xl flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">{brandRow}</div>
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Cerrar menú" className="-mr-2 -mt-2 w-10 h-10 rounded-lg inline-flex items-center justify-center text-gray-500 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
          {brandExtras}
        </div>
        {fullNav}
        {userFooter}
      </div>
    </div>
  ) : null;

  return (
    // h-dvh (no h-screen): en Safari de iPad 100vh incluye la barra del navegador y
    // dejaba el pie del menú fuera de la pantalla (crm-multidispositivo T0).
    <div className="flex h-dvh bg-gray-50">
      {/* Sidebar de escritorio (≥ lg), sin cambios respecto a la versión original */}
      <aside className="hidden lg:flex w-56 bg-white border-r border-gray-200 flex-col">
        <div className="p-4 border-b border-gray-200">
          {brandRow}
          {brandExtras}
        </div>
        {fullNav}
        {userFooter}
      </aside>

      {rail}
      {drawer}

      {/* Main content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {isSuper && actAs && <SuperadminBar tenantName={branding?.name ?? "la empresa"} />}
        {/* El provider siempre envuelve a las páginas (algunas usan useAppContext incluso
            durante el instante previo a la redirección); en modo proveedor solo se
            oculta la barra Empresa › Centro. */}
        <ContextBarProvider>
          {providerMode && (
            // Barra del modo proveedor: simétrica a la del modo empresa. "Cerrar sesión"
            // vive solo en el pie del menú (aside o cajón): aquí era redundante.
            <div className="border-b border-gray-200 bg-white px-3 lg:px-6 py-2 flex items-center gap-3 text-sm min-h-[44px]">
              <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú" className="lg:hidden -my-2 -ml-1 w-11 h-11 rounded-lg inline-flex items-center justify-center text-gray-600 hover:bg-gray-100"><Menu size={20} /></button>
              <span className="inline-flex items-center gap-1.5 font-medium text-blue-600 whitespace-nowrap"><Building2 size={15} strokeWidth={2} /> Panel de proveedor</span>
              <span className="ml-auto text-xs text-gray-500 truncate">{user.email}</span>
            </div>
          )}
          {!providerMode && <ContextBar empresaName={branding?.name ?? "MediRenova"} primaryColor={primary} onMenu={() => setDrawerOpen(true)} />}
          <div className="flex-1 overflow-y-auto">{children}</div>
        </ContextBarProvider>
      </main>
    </div>
  );
}
