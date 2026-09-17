import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { logoutAdmin } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="admin-kicker">Renacer Distribuidora</span>
          <strong>Panel de administración</strong>
        </div>
        <nav>
          <Link href="/admin/productos">Productos</Link>
          <Link href="/admin/configuracion">WhatsApp de pagos</Link>
          <Link href="/" target="_blank">Ver tienda</Link>
        </nav>
        <form action={logoutAdmin}><button className="admin-button admin-button-secondary" type="submit">Cerrar sesión</button></form>
      </header>
      {children}
    </main>
  );
}
