"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch, setTokens, clearTokens } from "@/lib/api";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Attempt to restore session from stored token
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setLoading(false);
      return;
    }

    // Decode JWT to get user info (no validation, just parse)
    try {
      const payload = JSON.parse(atob(token.split(".")[1]!));
      if (payload.exp * 1000 > Date.now()) {
        // Fetch user details - for now reconstruct from JWT claims
        // In production, consider GET /auth/me endpoint
        setUser({ id: payload.sub, email: "", firstName: "", lastName: "", role: payload.role, tenantId: payload.tid });
      } else {
        clearTokens();
      }
    } catch {
      clearTokens();
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const data = await apiFetch<{ accessToken: string; refreshToken: string; user: User }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    return data.user;
  }

  function logout() {
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
