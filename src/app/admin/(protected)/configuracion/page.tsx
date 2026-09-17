import { getCheckoutWhatsappNumber } from "@/lib/store-settings";
import { updateCheckoutWhatsapp } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [whatsapp, query] = await Promise.all([getCheckoutWhatsappNumber(), searchParams]);

  return (
    <div className="admin-content admin-content-narrow">
      <div className="admin-title-row">
        <div><span className="admin-kicker">Configuración comercial</span><h1>WhatsApp para links de pago</h1><p>Este número recibe el carrito y los datos del comprador desde el checkout.</p></div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card">
        <h2>Número receptor</h2>
        <p>Ingresa el número con código de país. Para Chile, por ejemplo: <strong>+56 9 9185 1942</strong>.</p>
        <form action={updateCheckoutWhatsapp} className="admin-form">
          <label>WhatsApp de pagos<input name="whatsapp" type="tel" required minLength={8} maxLength={40} defaultValue={`+${whatsapp}`} placeholder="+56991851942" /></label>
          <button className="admin-button admin-button-primary" type="submit">Guardar número</button>
        </form>
        <div className="admin-current-value"><span>Destino actual de solicitudes</span><strong>+{whatsapp}</strong></div>
      </section>
    </div>
  );
}
