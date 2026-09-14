"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await login(email, password);
      // El médico aterriza en su cabina (Consulta); el resto, en el panel.
      router.push(u.role === "DOCTOR" ? "/consulta" : "/dashboard");
    } catch {
      setError("Credenciales incorrectas. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-gray-50 to-gray-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center shadow-sm">
            <HeartPulse className="w-5 h-5" strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <span className="font-bold text-gray-900 text-lg tracking-tight">MediRenova</span>
            <p className="text-[11px] text-gray-500 -mt-0.5">Panel de gestión</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-teal-500 px-6 py-4 text-white">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/20 shrink-0"><Lock className="w-5 h-5" /></div>
              <h1 className="text-lg font-bold">Accede a tu cuenta</h1>
            </div>
            <p className="text-sm text-white/85 mt-1">Introduce tus credenciales para continuar.</p>
          </div>

          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <label htmlFor="email" className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-blue-500" /> Email</span>
                <input
                  id="email" type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400"
                  placeholder="usuario@clinica.es"
                />
              </label>

              <label htmlFor="password" className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-blue-500" /> Contraseña</span>
                <input
                  id="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400"
                  placeholder="••••••••"
                />
              </label>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-teal-500 text-white font-medium text-sm hover:opacity-95 disabled:opacity-60 shadow-sm transition-opacity"
              >
                {loading ? "Accediendo…" : "Acceder"}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-6">MediRenova · gestión de centros de reconocimiento</p>
      </div>
    </div>
  );
}
