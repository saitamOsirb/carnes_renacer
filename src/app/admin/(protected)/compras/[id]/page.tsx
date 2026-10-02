import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PurchaseOrderStatus, PurchaseReceiptDocumentType } from "@prisma/client";
import { notFound } from "next/navigation";
import { cancelPurchaseOrderAction, receivePurchaseOrderAction } from "@/app/admin/purchase-actions";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { formatQuantity, roundQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const statusLabel: Record<PurchaseOrderStatus, string> = {
  ORDERED: "Ordenada",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
};

const documentLabel: Record<PurchaseReceiptDocumentType, string> = {
  GUIA_DESPACHO: "Guía de despacho",
  FACTURA: "Factura",
  BOLETA: "Boleta",
  OTRO: "Otro",
};

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: true,
      items: { orderBy: { productName: "asc" } },
      receipts: {
        include: { items: { orderBy: { productName: "asc" } } },
        orderBy: { receivedAt: "desc" },
      },
    },
  });
  if (!order) notFound();

  const canReceive = order.status === PurchaseOrderStatus.ORDERED || order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED;
  const canCancel = order.status === PurchaseOrderStatus.ORDERED && order.receipts.length === 0;
  const pendingLines = order.items.filter((item) => toQuantityNumber(item.receivedQuantity) < toQuantityNumber(item.orderedQuantity));

  return (
    <div className="admin-content admin-content-narrow">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Orden de compra</span>
          <h1>{order.orderNumber}</h1>
          <p>{order.supplier.name} · recepción en {order.warehouse.name}</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/compras">← Compras</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/proveedores">Proveedores</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{statusLabel[order.status]}</strong><span>estado</span></div>
        <div className="admin-stat"><strong>{order.items.length}</strong><span>productos</span></div>
        <div className="admin-stat"><strong>{order.receipts.length}</strong><span>recepciones</span></div>
        <div className="admin-stat"><strong>{formatClp(order.totalAmount)}</strong><span>total orden</span></div>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Cabecera</h2><p>Condiciones acordadas al crear la orden.</p></div><span className={`billing-status is-${order.status.toLowerCase()}`}>{statusLabel[order.status]}</span></div>
        <div className="admin-grid admin-grid-3">
          <div><small>Proveedor</small><strong>{order.supplier.name}</strong><p>{order.supplier.rut ?? order.supplier.code}</p></div>
          <div><small>Bodega recepción</small><strong>{order.warehouse.name}</strong><p>{order.warehouse.code}</p></div>
          <div><small>Fecha orden</small><strong>{order.orderedAt.toLocaleString("es-CL")}</strong></div>
          <div><small>Fecha esperada</small><strong>{order.expectedDate ? order.expectedDate.toLocaleDateString("es-CL") : "Sin fecha"}</strong></div>
          <div><small>Referencia proveedor</small><strong>{order.supplierReference ?? "—"}</strong></div>
          <div><small>Condición de pago</small><strong>{order.supplier.paymentTermsDays} días</strong></div>
        </div>
        {order.notes && <div className="admin-inline-notice"><strong>Observaciones:</strong> {order.notes}</div>}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Detalle pedido vs. recibido</h2><p>La diferencia pendiente nunca se suma al inventario hasta registrar recepción.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Costo neto OC</th><th>Neto línea</th></tr></thead>
            <tbody>
              {order.items.map((item) => {
                const pending = roundQuantity(toQuantityNumber(item.orderedQuantity) - toQuantityNumber(item.receivedQuantity));
                return <tr key={item.id}>
                  <td><strong>{item.productName}</strong><small>{item.unit === "KG" ? "kilogramos" : "unidades"}</small></td>
                  <td>{formatQuantity(item.orderedQuantity, item.unit)}</td>
                  <td>{formatQuantity(item.receivedQuantity, item.unit)}</td>
                  <td className={pending > 0 ? "admin-qty-negative" : "admin-qty-positive"}>{formatQuantity(pending, item.unit)}</td>
                  <td>{formatClp(item.unitCostNet)}</td>
                  <td>{formatClp(item.netAmount)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="billing-document-totals">
          <div><span>Neto</span><strong>{formatClp(order.netAmount)}</strong></div>
          <div><span>IVA {order.vatRate}%</span><strong>{formatClp(order.vatAmount)}</strong></div>
          <div className="is-total"><span>Total</span><strong>{formatClp(order.totalAmount)}</strong></div>
        </div>
      </section>

      {canReceive && (
        <section className="admin-card admin-create-card">
          <div className="admin-card-heading"><div><h2>Registrar recepción</h2><p>Puedes recibir parcialmente. El costo real puede diferir del costo de la OC y queda guardado en la recepción.</p></div></div>
          <form action={receivePurchaseOrderAction} className="admin-form">
            <input type="hidden" name="purchaseOrderId" value={order.id} />
            <input type="hidden" name="requestKey" value={randomUUID()} />
            <div className="admin-grid admin-grid-3">
              <label>Documento proveedor
                <select name="documentType" defaultValue="">
                  <option value="">Sin documento</option>
                  {Object.values(PurchaseReceiptDocumentType).map((type) => <option key={type} value={type}>{documentLabel[type]}</option>)}
                </select>
              </label>
              <label>N° documento<input name="supplierDocumentNumber" maxLength={100} placeholder="Folio guía/factura" /></label>
              <label>Recibido por<input name="receivedBy" maxLength={80} defaultValue={process.env.ADMIN_USERNAME?.trim() || "admin"} required /></label>
              <label className="admin-grid-span-2">Observaciones recepción<input name="notes" maxLength={1000} /></label>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Producto</th><th>Pendiente</th><th>Recibir ahora</th><th>Costo neto real</th></tr></thead>
                <tbody>
                  {pendingLines.map((item) => {
                    const pending = roundQuantity(toQuantityNumber(item.orderedQuantity) - toQuantityNumber(item.receivedQuantity));
                    return <tr key={item.id}>
                      <td><strong>{item.productName}</strong></td>
                      <td>{formatQuantity(pending, item.unit)}</td>
                      <td><input name={`quantity_${item.id}`} type="number" min={0} max={pending} step={item.unit === "KG" ? 0.001 : 1} defaultValue={0} inputMode="decimal" /></td>
                      <td><input name={`cost_${item.id}`} type="number" min={1} step={1} defaultValue={item.unitCostNet} required /></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <div className="admin-inline-notice">Al confirmar, el stock físico aumenta en <strong>{order.warehouse.name}</strong>. La mercadería nueva queda sin ubicación WMS hasta asignarla a rack/cámara/pallet.</div>
            <button className="admin-button admin-button-primary" type="submit">Confirmar recepción e ingresar stock</button>
          </form>
        </section>
      )}

      {canCancel && (
        <section className="admin-card">
          <div className="admin-card-heading"><div><h2>Cancelar orden</h2><p>Disponible solo mientras no exista ninguna recepción.</p></div></div>
          <form action={cancelPurchaseOrderAction}>
            <input type="hidden" name="purchaseOrderId" value={order.id} />
            <button className="admin-button admin-button-danger" type="submit">Cancelar orden de compra</button>
          </form>
        </section>
      )}

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Historial de recepciones</h2><p>Snapshot del costo y cantidades realmente recibidas en cada evento.</p></div></div>
        {order.receipts.length === 0 ? <div className="pos-empty">Aún no existen recepciones para esta orden.</div> : (
          <div className="admin-products-list">
            {order.receipts.map((receipt) => {
              const net = receipt.items.reduce((sum, item) => sum + item.netAmount, 0);
              return <article className="admin-product-card" key={receipt.id}>
                <div className="admin-product-preview">
                  <div>
                    <strong>{receipt.receiptNumber}</strong>
                    <span>{receipt.receivedAt.toLocaleString("es-CL")} · {receipt.receivedBy}</span>
                    <small>{receipt.documentType ? documentLabel[receipt.documentType] : "Sin documento proveedor"}{receipt.supplierDocumentNumber ? ` · ${receipt.supplierDocumentNumber}` : ""}</small>
                  </div>
                  <strong>{formatClp(net)} neto recibido</strong>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo neto real</th><th>Neto</th><th>Dif. costo vs OC</th></tr></thead>
                    <tbody>
                      {receipt.items.map((line) => {
                        const orderedItem = order.items.find((item) => item.id === line.purchaseOrderItemId);
                        const difference = line.unitCostNet - (orderedItem?.unitCostNet ?? line.unitCostNet);
                        return <tr key={line.id}>
                          <td>{line.productName}</td>
                          <td>{formatQuantity(line.quantity, line.unit)}</td>
                          <td>{formatClp(line.unitCostNet)}</td>
                          <td>{formatClp(line.netAmount)}</td>
                          <td className={difference > 0 ? "admin-qty-negative" : difference < 0 ? "admin-qty-positive" : ""}>{difference === 0 ? "Sin diferencia" : `${difference > 0 ? "+" : ""}${formatClp(difference)}`}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                {receipt.notes && <div className="admin-inline-notice">{receipt.notes}</div>}
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
