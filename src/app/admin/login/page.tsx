import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { loginAdmin } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdminAuthenticated()) redirect("/admin/productos");
  const { error } = await searchParams;

  return (
    <main className="admin-login-wrap">
      <section className="admin-login-card">
        <span className="admin-kicker">Renacer Distribuidora</span>
        <h1>Administración</h1>
        <p>Ingresa la contraseña administrativa para mantener productos y configuración comercial.</p>
        {error && <div className="admin-alert admin-alert-error">{error}</div>}
        <form action={loginAdmin} className="admin-form">
          <label>Contraseña<input type="password" name="password" required minLength={10} autoComplete="current-password" /></label>
          <button className="admin-button admin-button-primary" type="submit">Ingresar</button>
        </form>
      </section>
    </main>
  );
}
