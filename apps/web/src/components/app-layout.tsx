"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

interface Branding { name: string; logoUrl: string | null; primaryColor: string; secondaryColor: string }
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  Building2,
  Package,
  ClipboardList,
  Zap,
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
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/appointments", label: "Reservas", icon: CalendarCheck },
  { href: "/customers", label: "Clientes", icon: Users },
  { href: "/centers", label: "Centros", icon: Building2 },
  { href: "/products", label: "Productos", icon: Package },
  { href: "/revisions", label: "Revisiones", icon: ClipboardList },
  { href: "/workflow", label: "Workflow", icon: Zap },
];

const adminNavItems: NavItem[] = [
  { href: "/users", label: "Equipo", icon: UserCog },
  { href: "/doctors", label: "Médicos", icon: Stethoscope },
  { href: "/forms", label: "Formularios", icon: FileText },
  { href: "/settings", label: "Configuración", icon: Settings },
];

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

  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";

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

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href as string}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname.startsWith(item.href) ? "font-medium" : "text-gray-600 hover:bg-gray-100"
              }`}
              style={pathname.startsWith(item.href) ? { backgroundColor: `${primary}14`, color: primary } : undefined}
            >
              <item.icon size={16} strokeWidth={1.75} />
              {item.label}
            </Link>
          ))}

          {isAdmin && (
            <>
              <div className="pt-3 pb-1">
                <p className="text-xs font-medium text-gray-400 px-3 uppercase tracking-wide">Admin</p>
              </div>
              {adminNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href as string}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    pathname.startsWith(item.href)
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <item.icon size={16} strokeWidth={1.75} />
                  {item.label}
                </Link>
              ))}
            </>
          )}
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
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
