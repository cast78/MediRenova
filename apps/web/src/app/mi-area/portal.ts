// Cliente del Portal del paciente. Sesión propia (token de portal en sessionStorage),
// independiente del login de staff. Pega al backend por el proxy `/api/proxy/portal/*`.
const BASE = "/api/proxy/portal";
const KEY = "portal_token";

export class PortalError extends Error {
  constructor(public status: number, public errors: unknown) { super(`Portal ${status}`); }
}

export function getPortalToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function setPortalToken(t: string): void {
  try { sessionStorage.setItem(KEY, t); } catch { /* noop */ }
}
export function clearPortalToken(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
}

export async function portalFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getPortalToken();
  const res = await fetch(`${BASE}/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let errors: unknown = null;
    try { errors = await res.json(); } catch { /* noop */ }
    throw new PortalError(res.status, errors);
  }
  const json = await res.json();
  return (json.data ?? json) as T;
}

// Descarga el PDF del certificado con la sesión de portal y lo abre en una pestaña.
export async function openPortalPdf(revisionId: string): Promise<void> {
  const token = getPortalToken();
  const res = await fetch(`${BASE}/revisions/${revisionId}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new PortalError(res.status, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
