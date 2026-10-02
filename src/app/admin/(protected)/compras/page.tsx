import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PurchaseOrderStatus } from "@prisma/client";
import { PurchaseOrderForm } from "@/components/admin/purchase-order-form";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const statusLabel: Record<PurchaseOrderStatus, string> = {
  ORDERED: "Ordenada",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
};

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string; status?: string; ok?: string; error?: string }>;
}) {
  const query = await searchParams;
  const supplierFilter = query.supplier?.slice(0, 30) ?? "";
  const statusFilter = Object.values(PurchaseOrderStatus).includes(query.status as PurchaseOrderStatus)
    ? query.status as PurchaseOrderStatus
    : undefined;

  const [suppliers, warehouses, products, orders] = await Promise.all([
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } }),
    prisma.purchaseOrder.findMany({
      where: {
        ...(supplierFilter ? { supplierId: supplierFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      include: {
        supplier: true,
        warehouse: true,
        items: { select: { orderedQuantity: true, receivedQuantity: true } },
        _count: { select: { receipts: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const openCount = orders.filter((order) => order.status === PurchaseOrderStatus.ORDERED || order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED).length;
  const partialCount = orders.filter((order) => order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED).length;
  const receivedCount = orders.filter((order) => order.status === PurchaseOrderStatus.RECEIVED).length;

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Abastecimiento</span>
          <h1>Compras y órdenes de compra</h1>
          <p>Ordena mercadería a proveedores, recibe parcial o totalmente y actualiza inventario con trazabilidad.</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/proveedores">Proveedores</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/inventario">Inventario</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{orders.length}</strong><span>órdenes mostradas</span></div>
        <div className="admin-stat"><strong>{openCount}</strong><span>pendientes</span></div>
        <div className="admin-stat"><strong>{partialCount}</strong><span>con recepción parcial</span></div>
        <div className="admin-stat"><strong>{receivedCount}</strong><span>recibidas completas</span></div>
      </section>

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading">
          <div><h2>Nueva orden de compra</h2><p>Las cantidades recibidas no se cargan al stock hasta registrar una recepción.</p></div>
        </div>
        {suppliers.length === 0 || warehouses.length === 0 || products.length === 0 ? (
          <div className="admin-inline-notice">Para crear una OC necesitas al menos un proveedor activo, una bodega activa y un producto activo.</div>
        ) : (
          <PurchaseOrderForm
            requestKey={randomUUID()}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, label: `${supplier.code} · ${supplier.name}` }))}
            warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, label: `${warehouse.code} · ${warehouse.name}` }))}
            products={products.map((product) => ({ id: product.id, name: product.name, unit: product.unit }))}
            defaultSupplierId={supplierFilter || undefined}
          />
        )}
      </section>

      <section className="admin-card admin-create-card">
        <form method="get" className="admin-form admin-grid admin-grid-3">
          <label>Proveedor
            <select name="supplier" defaultValue={supplierFilter}>
              <option value="">Todos</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>Estado
            <select name="status" defaultValue={statusFilter ?? ""}>
              <option value="">Todos</option>
              {Object.values(PurchaseOrderStatus).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
            </select>
          </label>
          <div className="pos-page-actions">
            <button className="admin-button admin-button-secondary" type="submit">Filtrar</button>
            {(supplierFilter || statusFilter) && <Link className="admin-button admin-button-secondary" href="/admin/compras">Limpiar</Link>}
          </div>
        </form>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Historial de órdenes</h2><p>Las diferencias de recepción quedan visibles dentro de cada orden.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Fecha</th><th>Orden</th><th>Proveedor</th><th>Bodega</th><th>Avance</th><th>Total</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={8}>No hay órdenes de compra para los filtros seleccionados.</td></tr>}
              {orders.map((order) => {
                const completeLines = order.items.filter((item) => toQuantityNumber(item.receivedQuantity) >= toQuantityNumber(item.orderedQuantity)).length;
                return (
                  <tr key={order.id}>
                    <td>{order.orderedAt.toLocaleDateString("es-CL")}</td>
                    <td><strong>{order.orderNumber}</strong><small>{order.supplierReference ?? "Sin referencia proveedor"}</small></td>
                    <td>{order.supplier.name}<small>{order.supplier.rut ?? order.supplier.code}</small></td>
                    <td>{order.warehouse.name}</td>
                    <td>{completeLines}/{order.items.length} líneas<small>{order._count.receipts} recepciones</small></td>
                    <td><strong>{formatClp(order.totalAmount)}</strong><small>Neto {formatClp(order.netAmount)}</small></td>
                    <td><span className={`billing-status is-${order.status.toLowerCase()}`}>{statusLabel[order.status]}</span></td>
                    <td><Link className="billing-link" href={`/admin/compras/${order.id}`}>Detalle</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
