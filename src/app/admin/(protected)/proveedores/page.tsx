import Link from "next/link";
import { Prisma } from "@prisma/client";
import { createSupplierAction, updateSupplierAction } from "@/app/admin/supplier-actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ok?: string; error?: string }>;
}) {
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 100) ?? "";
  const where: Prisma.SupplierWhereInput = q
    ? {
        OR: [
          { name: { contains: q } },
          { code: { contains: q } },
          { rut: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const suppliers = await prisma.supplier.findMany({
    where,
    include: { _count: { select: { purchaseOrders: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 250,
  });

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Abastecimiento</span>
          <h1>Proveedores</h1>
          <p>Mantenedor de proveedores para órdenes de compra, recepción e historial de abastecimiento.</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-primary" href="/admin/compras">Órdenes de compra</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/inventario">Inventario</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading">
          <div><h2>Nuevo proveedor</h2><p>RUT es opcional para el maestro, pero cuando se ingresa se valida y no puede repetirse.</p></div>
        </div>
        <form action={createSupplierAction} className="admin-form">
          <div className="admin-grid admin-grid-3">
            <label>Código<input name="code" required minLength={2} maxLength={40} placeholder="PROV-CARNES-01" /></label>
            <label>Razón social / nombre<input name="name" required minLength={2} maxLength={191} /></label>
            <label>RUT <small>(opcional)</small><input name="rut" maxLength={20} placeholder="76.123.456-7" /></label>
            <label>Contacto<input name="contactName" maxLength={191} /></label>
            <label>Correo<input name="email" type="email" maxLength={191} /></label>
            <label>Teléfono<input name="phone" type="tel" maxLength={40} /></label>
            <label>Dirección<input name="address" maxLength={255} /></label>
            <label>Comuna<input name="commune" maxLength={120} /></label>
            <label>Ciudad<input name="city" maxLength={120} /></label>
            <label>Plazo pago (días)<input name="paymentTermsDays" type="number" min={0} max={3650} defaultValue={0} required /></label>
            <label className="admin-grid-span-2">Observaciones<textarea name="notes" maxLength={1000} rows={3} /></label>
          </div>
          <button className="admin-button admin-button-primary" type="submit">Crear proveedor</button>
        </form>
      </section>

      <section className="admin-card admin-create-card">
        <form method="get" className="admin-form admin-grid admin-grid-3">
          <label>Buscar proveedor<input name="q" defaultValue={q} placeholder="Nombre, código, RUT, correo o teléfono" /></label>
          <button className="admin-button admin-button-secondary" type="submit">Buscar</button>
          {q && <Link className="admin-button admin-button-secondary" href="/admin/proveedores">Limpiar búsqueda</Link>}
        </form>
      </section>

      <section className="admin-products-list">
        {suppliers.length === 0 && <div className="admin-card pos-empty">No se encontraron proveedores.</div>}
        {suppliers.map((supplier) => (
          <article className={`admin-product-card${supplier.active ? "" : " is-inactive"}`} key={supplier.id}>
            <div className="admin-product-preview">
              <div>
                <strong>{supplier.name}</strong>
                <span>{supplier.code} · {supplier.active ? "Activo" : "Inactivo"}</span>
                <small>{supplier.rut ?? "Sin RUT"} · {supplier._count.purchaseOrders} órdenes de compra</small>
              </div>
            </div>

            <form action={updateSupplierAction} className="admin-form">
              <input type="hidden" name="id" value={supplier.id} />
              <div className="admin-grid admin-grid-3">
                <label>Código<input name="code" required defaultValue={supplier.code} maxLength={40} /></label>
                <label>Razón social / nombre<input name="name" required defaultValue={supplier.name} maxLength={191} /></label>
                <label>RUT<input name="rut" defaultValue={supplier.rut ?? ""} maxLength={20} /></label>
                <label>Contacto<input name="contactName" defaultValue={supplier.contactName ?? ""} maxLength={191} /></label>
                <label>Correo<input name="email" type="email" defaultValue={supplier.email ?? ""} maxLength={191} /></label>
                <label>Teléfono<input name="phone" type="tel" defaultValue={supplier.phone ?? ""} maxLength={40} /></label>
                <label>Dirección<input name="address" defaultValue={supplier.address ?? ""} maxLength={255} /></label>
                <label>Comuna<input name="commune" defaultValue={supplier.commune ?? ""} maxLength={120} /></label>
                <label>Ciudad<input name="city" defaultValue={supplier.city ?? ""} maxLength={120} /></label>
                <label>Plazo pago (días)<input name="paymentTermsDays" type="number" min={0} max={3650} defaultValue={supplier.paymentTermsDays} required /></label>
                <label className="admin-grid-span-2">Observaciones<textarea name="notes" defaultValue={supplier.notes ?? ""} maxLength={1000} rows={3} /></label>
              </div>
              <div className="admin-checks"><label><input type="checkbox" name="active" defaultChecked={supplier.active} /> Activo</label></div>
              <div className="pos-page-actions">
                <button className="admin-button admin-button-primary" type="submit">Guardar proveedor</button>
                <Link className="admin-button admin-button-secondary" href={`/admin/compras?supplier=${supplier.id}`}>Ver compras</Link>
              </div>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}
