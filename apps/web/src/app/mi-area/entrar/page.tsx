"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setPortalToken } from "../portal";

// Landing del enlace mágico: guarda el token de sesión y entra al panel.
function Entrar() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const t = sp.get("token");
    if (t) setPortalToken(t);
    router.replace("/mi-area/panel");
  }, [sp, router]);
  return <p className="text-gray-500 text-sm text-center">Entrando en tu área…</p>;
}

export default function EntrarPage() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <Suspense fallback={<p className="text-gray-500 text-sm text-center">Entrando…</p>}><Entrar /></Suspense>
    </div>
  );
}
