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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export { setTokens, clearTokens, getAccessToken };
