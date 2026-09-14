import { HeartPulse } from "lucide-react";

// Layout del Portal del paciente: identidad MediRenova, mobile-first, sin el chrome
// del panel de staff. Fondo suave con acento de marca.
export default function MiAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-gray-50 to-gray-50 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 text-white flex items-center justify-center shadow-sm">
            <HeartPulse className="w-5 h-5" strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <span className="font-bold text-gray-900 text-lg tracking-tight">MediRenova</span>
            <p className="text-[11px] text-gray-500 -mt-0.5">Portal del paciente</p>
          </div>
        </div>
        {children}
        <p className="text-center text-[11px] text-gray-400 mt-6">Tus datos, siempre a tu alcance · <span className="text-gray-500 font-medium">MediRenova</span></p>
      </div>
    </div>
  );
}
