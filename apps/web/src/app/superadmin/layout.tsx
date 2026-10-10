import AppLayout from "@/components/app-layout";

// Panel de proveedor (crm-planes): mismo shell que el resto de la app; en modo
// proveedor el AppLayout muestra el menú corto y la barra superior del proveedor.
export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
