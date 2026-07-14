const API_BASE =
  typeof window !== "undefined"
    ? "/api/proxy"
    : (process.env["API_URL"] ?? "http://localhost:3001/api/v1");

export class ApiError extends Error {
  constructor(public status: number, public errors: unknown, public data?: unknown) {
    super(`API Error ${status}`);
  }
}

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem("access_token", accessToken);
  localStorage.setItem("refresh_token", refreshToken);
}

function clearTokens(): void {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

// Empresa que un SUPERADMIN está "viendo" (impersonación). Se manda como cabecera
// `x-act-as-tenant`; el backend solo la respeta para el rol SUPERADMIN.
const ACT_AS_KEY = "act_as_tenant";
function getActAsTenant(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACT_AS_KEY);
}
function setActAsTenant(tenantId: string | null): void {
  if (typeof window === "undefined") return;
  if (tenantId) localStorage.setItem(ACT_AS_KEY, tenantId);
  else localStorage.removeItem(ACT_AS_KEY);
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return null;
    }

    const data = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
    setTokens(data.data.accessToken, data.data.refreshToken);
    return data.data.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { raw?: boolean },
  retry = true,
): Promise<T> {
  const { raw, ...fetchOptions } = options ?? {};
  const token = getAccessToken();
  const actAs = getActAsTenant();
  const headers: Record<string, string> = {
    // Solo con cuerpo: Fastify responde 400 si llega Content-Type: application/json
    // con cuerpo vacío (FST_ERR_CTP_EMPTY_JSON_BODY) en POST/DELETE sin body.
    ...(fetchOptions.body != null ? { "Content-Type": "application/json" } : {}),
    ...(fetchOptions.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(actAs ? { "x-act-as-tenant": actAs } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers });

  if (res.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, options, false);
    }
    clearTokens();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, [{ code: "UNAUTHORIZED" }]);
  }

  const json = (await res.json()) as { data?: unknown; errors?: unknown };

  if (!res.ok) {
    throw new ApiError(res.status, json.errors, json.data);
  }

  return (raw ? json : json.data) as T;
}

// Cabeceras para fetch() directo (descargas binarias): token + impersonación de
// empresa del superadmin. Los fetch crudos deben usar esto para respetar el
// "actuar como" igual que apiFetch.
function authHeaders(base?: Record<string, string>): Record<string, string> {
  const token = getAccessToken();
  const actAs = getActAsTenant();
  return {
    ...(base ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(actAs ? { "x-act-as-tenant": actAs } : {}),
  };
}

export { setTokens, clearTokens, getAccessToken, getActAsTenant, setActAsTenant, authHeaders };
