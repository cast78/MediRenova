import { redirect } from "next/navigation";

// Enlace corto: /b/CODE → resuelve el token en la API y redirige según el tipo
// de enlace: auto-reserva (/booking), confirmar cita (/confirmar) o acceso al
// portal (/mi-area/entrar). Server component (resuelve antes de renderizar).
function target(kind: string | undefined, token: string): string {
  if (kind === "confirm") return `/confirmar/${token}`;
  if (kind === "portal") return `/mi-area/entrar?token=${token}`;
  return `/booking/${token}`;
}

export default async function ShortLinkPage({ params }: { params: { code: string } }) {
  const apiBase = process.env["API_URL"] ?? "http://127.0.0.1:3001/api/v1";
  let token: string | null = null;
  let kind: string | undefined;
  try {
    const res = await fetch(`${apiBase}/link/short/${encodeURIComponent(params.code)}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { data?: { token?: string; kind?: string } };
      token = json.data?.token ?? null;
      kind = json.data?.kind;
    }
  } catch {
    token = null;
  }

  if (token) redirect(target(kind, token));

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm max-w-sm w-full p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Enlace no válido</h1>
        <p className="text-sm text-gray-500">Este enlace no es correcto o ha caducado. Contacta con el centro para reservar tu cita.</p>
      </div>
    </main>
  );
}
