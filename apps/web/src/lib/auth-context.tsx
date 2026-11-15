"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { apiFetch, setTokens, clearTokens, getAccessToken, refreshAccessToken, tokenExpiry } from "@/lib/api";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Renueva el token de acceso un minuto antes de que caduque (dura 15 min), para
// que una sesión abierta no llegue a recibir 401 en ráfaga.
const REFRESH_MARGIN_MS = 60_000;

// Usuario reconstruido desde las claims del JWT (id, rol, empresa); el resto lo
// completa GET /auth/me.
function userFromToken(token: string): User | null {
  try {
    const p = JSON.parse(atob(token.split(".")[1]!)) as { sub: string; role: string; tid: string };
    return { id: p.sub, email: "", firstName: "", lastName: "", role: p.role, tenantId: p.tid };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Programa la renovación anticipada según la caducidad del token actual.
  const scheduleRefresh = useCallback((token: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    const exp = tokenExpiry(token);
    if (!exp) return;
    const delay = Math.max(5_000, exp - Date.now() - REFRESH_MARGIN_MS);
    timer.current = setTimeout(async () => {
      const next = await refreshAccessToken();
      if (next) scheduleRefresh(next);
      else if (!localStorage.getItem("refresh_token")) { setUser(null); window.location.href = "/login"; }
      else scheduleRefresh(getAccessToken()); // fallo transitorio: se reintenta cerca de la caducidad
    }, delay);
  }, []);

  useEffect(() => {
    // Restaura la sesión al cargar. Antes, un token de acceso caducado (15 min)
    // borraba la sesión sin intentar renovarla y la web volvía al login al
    // recargar; ahora se renueva con el refresh token (válido 7 días).
    let cancelled = false;
    (async () => {
      let token = getAccessToken();
      const exp = tokenExpiry(token);
      if (!token || !exp || exp <= Date.now() + 5_000) {
        token = localStorage.getItem("refresh_token") ? await refreshAccessToken() : null;
      }
      if (cancelled) return;
      if (!token) { clearTokens(); setLoading(false); return; }
      const fromToken = userFromToken(token);
      if (!fromToken) { clearTokens(); setLoading(false); return; }
      setUser(fromToken);
      setLoading(false);
      scheduleRefresh(token);
      // Datos completos (email, nombre) sin esperar: la app ya puede pintar.
      apiFetch<User>("/auth/me").then((u) => { if (!cancelled) setUser(u); }).catch(() => {});
    })();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [scheduleRefresh]);

  // Si la pestaña vuelve del segundo plano con el token caducado (el temporizador
  // no corre fiable en pestañas inactivas), renueva al instante. Y si una
  // petición renovó el token por un 401, se reprograma con el token nuevo.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const exp = tokenExpiry(getAccessToken());
      if (exp && exp - Date.now() < REFRESH_MARGIN_MS && localStorage.getItem("refresh_token")) {
        void refreshAccessToken().then((t) => { if (t) scheduleRefresh(t); });
      }
    };
    const onRefreshed = (e: Event) => scheduleRefresh((e as CustomEvent<string>).detail);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("mr:token-refreshed", onRefreshed);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("mr:token-refreshed", onRefreshed);
    };
  }, [scheduleRefresh]);

  async function login(email: string, password: string) {
    const data = await apiFetch<{ accessToken: string; refreshToken: string; user: User }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    scheduleRefresh(data.accessToken);
    return data.user;
  }

  function logout() {
    if (timer.current) clearTimeout(timer.current);
    const refreshToken = localStorage.getItem("refresh_token");
    if (refreshToken) {
      apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => {});
    }
    clearTokens();
    setUser(null);
    window.location.href = "/login";
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
