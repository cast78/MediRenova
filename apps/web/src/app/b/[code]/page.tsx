import { redirect } from "next/navigation";

// Enlace corto: /b/CODE → resuelve el token en la API y redirige a la página pública
// de auto-reserva /booking/TOKEN. Server component (resuelve antes de renderizar).
export default async function ShortLinkPage({ params }: { params: { code: string } }) {
  const apiBase = process.env["API_URL"] ?? "http://127.0.0.1:3001/api/v1";
  let token: string | null = null;
  try {
    const res = await fetch(`${apiBase}/link/short/${encodeURIComponent(params.code)}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { data?: { token?: string } };
      token = json.data?.token ?? null;
    }
  } catch {
    token = null;
  }

  if (token) redirect(`/booking/${token}`);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm max-w-sm w-full p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Enlace no válido</h1>
        <p className="text-sm text-gray-500">Este enlace no es correcto o ha caducado. Contacta con el centro para reservar tu cita.</p>
      </div>
    </main>
  );
}
