import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { logoutAdmin } from "@/app/admin/actions";
import { AdminDashboardNav } from "@/components/admin/admin-dashboard-nav";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="admin-dashboard">
      <AdminDashboardNav />

      <div className="admin-dashboard-main">
        <header className="admin-dashboard-topbar">
          <div className="admin-dashboard-topbar-title">
            <small>Renacer Distribuidora</small>
            <strong>Panel de administración</strong>
          </div>

          <div className="admin-dashboard-topbar-actions">
            <Link className="admin-dashboard-topbar-store" href="/" target="_blank" rel="noreferrer">Ver tienda</Link>
            <form action={logoutAdmin}>
              <button className="admin-button admin-button-secondary" type="submit">Cerrar sesión</button>
            </form>
          </div>
        </header>

        <main className="admin-dashboard-content">{children}</main>
      </div>
    </div>
  );
}
