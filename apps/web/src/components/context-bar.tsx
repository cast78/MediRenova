"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, MapPin, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface CtxCenter { id: string; name: string; lat?: number | null; lng?: number | null; address?: string | null; city?: string | null; province?: string | null }
interface AppCtx { centers: CtxCenter[]; centerId: string; setCenterId: (id: string) => void }

// Enlace a Google Maps del centro: por coordenadas si las hay, si no por dirección.
function mapsUrl(c: CtxCenter): string | null {
  if (c.lat != null && c.lng != null) return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
  const addr = [c.address, c.city, c.province].filter(Boolean).join(", ");
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}

const Ctx = createContext<AppCtx | null>(null);

export function useAppContext(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAppContext debe usarse dentro de ContextBarProvider");
  return c;
}

// Módulos que entienden la dimensión de centro (muestran el selector de centro).
const CENTER_AWARE = ["/dashboard", "/visits", "/appointments", "/revisions"];

const CENTER_KEY = "ctx_center1"; // v1: la clave se bumpéó para limpiar valores viejos

// Contexto global de "centro seleccionado", compartido por todos los módulos
// operativos y persistido en localStorage. Por defecto "" = Todos los centros.
export function ContextBarProvider({ children }: { children: React.ReactNode }) {
  const { data: centers } = useQuery<CtxCenter[]>({
    queryKey: ["ctx-centers"],
    queryFn: () => apiFetch<CtxCenter[]>("/centers"),
    staleTime: 5 * 60_000,
  });
  const [centerId, setCenterIdState] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(CENTER_KEY) ?? "" : "",
  );
  const setCenterId = (id: string) => {
    setCenterIdState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(CENTER_KEY, id);
      else localStorage.removeItem(CENTER_KEY);
    }
  };
  // Si el centro guardado ya no es visible (p. ej. el superadmin cambió de empresa),
  // se resetea para no filtrar por un centro ajeno.
  useEffect(() => {
    if (centerId && centers && !centers.some((c) => c.id === centerId)) setCenterId("");
  }, [centers, centerId]);

  return <Ctx.Provider value={{ centers: centers ?? [], centerId, setCenterId }}>{children}</Ctx.Provider>;
}

// Barra superior de contexto: Empresa › Centro, progresiva según el módulo.
export function ContextBar({ empresaName, primaryColor }: { empresaName: string; primaryColor: string }) {
  const pathname = usePathname();
  const { centers, centerId, setCenterId } = useAppContext();
  const aware = CENTER_AWARE.some((p) => pathname.startsWith(p));

  const onlyOne = centers.length <= 1;

  // Centro "activo" (el único, o el seleccionado) → icono de ubicación clicable.
  const activeCenter = onlyOne ? centers[0] ?? null : centers.find((c) => c.id === centerId) ?? null;
  const maps = activeCenter ? mapsUrl(activeCenter) : null;
  const pin = maps ? (
    <a href={maps} target="_blank" rel="noopener noreferrer" title="Ver ubicación en Google Maps" aria-label="Ver en Google Maps" className="text-gray-400 hover:text-blue-600 transition-colors">
      <MapPin size={14} strokeWidth={2} />
    </a>
  ) : (
    <MapPin size={14} strokeWidth={2} className="text-gray-400" />
  );

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-2 flex items-center gap-2 text-sm min-h-[44px]">
      <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: primaryColor }}>
        <Building2 size={15} strokeWidth={2} />
        {empresaName}
      </span>

      {aware && centers.length > 0 && (
        <>
          <ChevronRight size={14} className="text-gray-300" />
          {onlyOne ? (
            <span className="inline-flex items-center gap-1.5 text-gray-700">
              {pin}
              {centers[0]?.name ?? "—"}
            </span>
          ) : (
            <div className="inline-flex items-center gap-1.5">
              {pin}
              <select
                value={centerId}
                onChange={(e) => setCenterId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los centros</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
