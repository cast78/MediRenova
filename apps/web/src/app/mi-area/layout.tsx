// Layout ligero del Portal del paciente: sin el chrome del panel de staff.
// Centrado y mobile-first (el paciente entra desde el móvil).
export default function MiAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
