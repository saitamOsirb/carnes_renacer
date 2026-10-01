import Link from "next/link";
import { Prisma } from "@prisma/client";
import { anonymizeCustomer, createCustomer, updateCustomer } from "@/app/admin/customer-actions";
import {
  CUSTOMER_PRIVACY_ADMIN_NOTE,
  CUSTOMER_PRIVACY_NOTICE_SUMMARY,
  CUSTOMER_PRIVACY_NOTICE_VERSION,
} from "@/lib/customer-privacy";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; error?: string }> }) {
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 100) ?? "";
  const where: Prisma.CustomerWhereInput = q
    ? {
        OR: [
          { name: { contains: q } },
          { rut: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    include: { _count: { select: { posSales: true, consentEvents: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 200,
  });

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Clientes</span>
          <h1>Registro de clientes</h1>
          <p>Datos mínimos para identificar clientes y asociar compras, con marketing separado y trazabilidad de privacidad.</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/pos">Ir al POS</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/pos/cajas">Cajas</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading">
          <div>
            <h2>Privacidad por diseño</h2>
            <p>{CUSTOMER_PRIVACY_NOTICE_SUMMARY}</p>
          </div>
        </div>
        <div className="admin-inline-notice">
          <strong>Versión del aviso:</strong> {CUSTOMER_PRIVACY_NOTICE_VERSION}. {CUSTOMER_PRIVACY_ADMIN_NOTE}
        </div>
        <p>Una venta puede registrarse como cliente ocasional sin crear un perfil. La autorización de marketing nunca es requisito para vender.</p>
      </section>

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading"><div><h2>Nuevo cliente</h2><p>RUT y datos de contacto son opcionales. Registra solo lo necesario.</p></div></div>
        <form action={createCustomer} className="admin-form">
          <div className="admin-grid admin-grid-3">
            <label>Nombre<input name="name" required minLength={2} maxLength={191} /></label>
            <label>RUT <small>(opcional)</small><input name="rut" maxLength={20} placeholder="12.345.678-5" /></label>
            <label>Correo <small>(opcional)</small><input name="email" type="email" maxLength={191} /></label>
            <label>Teléfono <small>(opcional)</small><input name="phone" type="tel" maxLength={40} placeholder="+56 9 1234 5678" /></label>
            <label>Dirección <small>(opcional)</small><input name="address" maxLength={255} /></label>
          </div>
          <div className="admin-checks">
            <label><input type="checkbox" name="privacyAcknowledged" required /> Cliente informado del aviso de privacidad vigente</label>
            <label><input type="checkbox" name="marketingConsent" /> Autoriza comunicaciones comerciales</label>
          </div>
          <button className="admin-button admin-button-primary" type="submit">Registrar cliente</button>
        </form>
      </section>

      <section className="admin-card admin-create-card">
        <form method="get" className="admin-form admin-grid admin-grid-3">
          <label>Buscar cliente<input name="q" defaultValue={q} placeholder="Nombre, RUT, correo o teléfono" /></label>
          <button className="admin-button admin-button-secondary" type="submit">Buscar</button>
          {q && <Link className="admin-button admin-button-secondary" href="/admin/clientes">Limpiar búsqueda</Link>}
        </form>
      </section>

      <section className="admin-products-list">
        {customers.length === 0 && <div className="admin-card pos-empty">No se encontraron clientes.</div>}
        {customers.map((customer) => (
          <article className={`admin-product-card${customer.active ? "" : " is-inactive"}`} key={customer.id}>
            <div className="admin-product-preview">
              <div>
                <strong>{customer.name}</strong>
                <span>{customer.anonymizedAt ? "Anonimizado" : customer.active ? "Activo" : "Inactivo"}</span>
                <small>{customer._count.posSales} ventas POS · {customer._count.consentEvents} eventos de consentimiento</small>
              </div>
            </div>

            {!customer.anonymizedAt ? (
              <>
                <form action={updateCustomer} className="admin-form">
                  <input type="hidden" name="id" value={customer.id} />
                  <div className="admin-grid admin-grid-3">
                    <label>Nombre<input name="name" required defaultValue={customer.name} maxLength={191} /></label>
                    <label>RUT<input name="rut" defaultValue={customer.rut ?? ""} maxLength={20} /></label>
                    <label>Correo<input name="email" type="email" defaultValue={customer.email ?? ""} maxLength={191} /></label>
                    <label>Teléfono<input name="phone" type="tel" defaultValue={customer.phone ?? ""} maxLength={40} /></label>
                    <label>Dirección<input name="address" defaultValue={customer.address ?? ""} maxLength={255} /></label>
                  </div>
                  <div className="admin-checks">
                    <label><input type="checkbox" name="active" defaultChecked={customer.active} /> Activo</label>
                    <label><input type="checkbox" name="marketingConsent" defaultChecked={customer.marketingConsent} /> Autoriza comunicaciones comerciales</label>
                    <span className="admin-reserved">Aviso: {customer.privacyNoticeVersion}</span>
                    {customer.privacyAcknowledgedAt && <span className="admin-reserved">Informado: {customer.privacyAcknowledgedAt.toLocaleDateString("es-CL")}</span>}
                  </div>
                  <button className="admin-button admin-button-primary" type="submit">Guardar cliente</button>
                </form>

                <form action={anonymizeCustomer} className="admin-delete-form">
                  <input type="hidden" name="id" value={customer.id} />
                  <input name="confirm" maxLength={20} placeholder="Escribe ANONIMIZAR" aria-label={`Confirmar anonimización de ${customer.name}`} />
                  <button className="admin-button admin-button-danger" type="submit">Anonimizar perfil</button>
                  <small>Elimina los datos del perfil maestro. Las ventas históricas conservan su snapshot transaccional.</small>
                </form>
              </>
            ) : (
              <div className="admin-inline-notice">Perfil anonimizado el {customer.anonymizedAt.toLocaleString("es-CL")}. No puede reactivarse ni volver a completarse.</div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
