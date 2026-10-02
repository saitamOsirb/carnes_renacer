import { randomUUID } from "node:crypto";
import Link from "next/link";
import { DispatchStatus, DispatchType } from "@prisma/client";
import { createSaleDispatchAction } from "@/app/admin/dispatch-actions";
import { DispatchTransferBuilder } from "@/components/admin/dispatch-transfer-builder";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { roundQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const statusLabel: Record<DispatchStatus, string> = {
  DRAFT: "Borrador",
  READY: "Guía preparada",
  DISPATCHED: "En tránsito",
  RECEIVED: "Recibido",
  CANCELLED: "Cancelado",
};

const typeLabel: Record<DispatchType, string> = {
  SALE_DELIVERY: "Despacho de venta",
  INTERNAL_TRANSFER: "Traslado interno",
  OTHER: "Otro traslado",
};

export default async function DispatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; dispatch?: string }>;
}) {
  const [query, dispatches, sales, warehouses, products, stocks] = await Promise.all([
    searchParams,
    prisma.dispatch.findMany({
      include: {
        sourceWarehouse: true,
        destinationWarehouse: true,
        sale: { select: { id: true, saleNumber: true, customerName: true } },
        order: { select: { id: true, orderNumber: true, customerName: true } },
        dteDocuments: { where: { typeCode: 52 }, orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.posSale.findMany({
      where: { dispatches: { none: { status: { not: DispatchStatus.CANCELLED } } } },
      include: { warehouse: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, unit: true, price: true }, orderBy: { name: "asc" } }),
    prisma.inventoryStock.findMany({ select: { warehouseId: true, productId: true, onHand: true, reserved: true } }),
  ]);

  const inTransit = dispatches.filter((dispatch) => dispatch.status === DispatchStatus.DISPATCHED).length;
  const ready = dispatches.filter((dispatch) => dispatch.status === DispatchStatus.READY).length;
  const received = dispatches.filter((dispatch) => dispatch.status === DispatchStatus.RECEIVED).length;
  const activeWarehouses = warehouses.map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name, address: warehouse.address }));
  const productOptions = products.map((product) => ({ id: product.id, name: product.name, unit: product.unit, price: product.price }));
  const stockOptions = stocks.map((stock) => ({
    warehouseId: stock.warehouseId,
    productId: stock.productId,
    available: roundQuantity(Math.max(0, toQuantityNumber(stock.onHand) - toQuantityNumber(stock.reserved))),
  }));

  return (
    <div className="admin-content dispatch-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Logística · Chile</span>
          <h1>Despachos y Guías 52</h1>
          <p>Prepara despachos de venta y traslados internos, emite la guía electrónica y controla salida, tránsito y recepción.</p>
        </div>
        <Link href="/admin/facturacion" className="admin-button admin-button-secondary">Facturación SII</Link>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}{query.dispatch && <> · <Link href={`/admin/despachos/${query.dispatch}`}>Ver despacho</Link></>}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{dispatches.length}</strong><span>despachos recientes</span></div>
        <div className="admin-stat"><strong>{ready}</strong><span>listos con guía</span></div>
        <div className={`admin-stat${inTransit > 0 ? " admin-stat-warning" : ""}`}><strong>{inTransit}</strong><span>en tránsito</span></div>
        <div className="admin-stat"><strong>{received}</strong><span>recibidos</span></div>
      </section>

      <section className="admin-report-grid-2 pos-management-section">
        <div className="admin-card">
          <div className="admin-card-heading"><div><span className="admin-kicker">Venta POS</span><h2>Crear despacho de venta</h2><p>La venta ya descontó inventario. Crear o emitir la guía no vuelve a descontarlo.</p></div></div>
          <form action={createSaleDispatchAction} className="admin-form">
            <input type="hidden" name="requestKey" value={randomUUID()} />
            <label>Venta
              <select name="saleId" required defaultValue="">
                <option value="" disabled>Selecciona una venta sin despacho activo</option>
                {sales.map((sale) => <option key={sale.id} value={sale.id}>{sale.saleNumber} · {sale.customerName ?? "Consumidor final"} · {formatClp(sale.total)} · {sale.warehouse.name}</option>)}
              </select>
            </label>
            <label>Motivo del traslado<textarea name="reason" required maxLength={500} rows={2} placeholder="Entrega de venta a cliente" /></label>
            <label>Código motivo / IndTraslado<input name="transferReasonCode" maxLength={10} placeholder="Completar según configuración/certificación SII" /></label>
            <div className="admin-grid admin-grid-2">
              <label>Receptor<input name="receiverName" required maxLength={191} /></label>
              <label>RUT receptor<input name="receiverRut" maxLength={20} /></label>
              <label>Dirección destino<input name="receiverAddress" required maxLength={255} /></label>
              <label>Comuna<input name="receiverCommune" required maxLength={120} /></label>
              <label>Ciudad<input name="receiverCity" maxLength={120} /></label>
              <label>Giro<input name="receiverGiro" maxLength={191} /></label>
            </div>
            <details className="billing-invoice-form">
              <summary>Transporte y conductor</summary>
              <div className="admin-grid admin-grid-2">
                <label>Patente vehículo<input name="vehiclePlate" maxLength={20} /></label>
                <label>Patente remolque<input name="trailerPlate" maxLength={20} /></label>
                <label>RUT transportista<input name="transportCompanyRut" maxLength={20} /></label>
                <label>Transportista<input name="transportCompanyName" maxLength={191} /></label>
                <label>RUT conductor<input name="driverRut" maxLength={20} /></label>
                <label>Nombre conductor<input name="driverName" maxLength={191} /></label>
              </div>
            </details>
            <label>Observaciones<textarea name="notes" maxLength={1000} rows={2} /></label>
            <button className="admin-button admin-button-primary" type="submit" disabled={sales.length === 0}>Crear despacho</button>
          </form>
        </div>

        <div className="admin-card">
          <div className="admin-card-heading"><div><span className="admin-kicker">Entre bodegas</span><h2>Crear traslado interno</h2><p>El stock permanece en origen hasta marcar el despacho como salido y entra al destino al confirmar recepción.</p></div></div>
          {activeWarehouses.length >= 2
            ? <DispatchTransferBuilder requestKey={randomUUID()} warehouses={activeWarehouses} products={productOptions} stocks={stockOptions} />
            : <div className="pos-empty">Necesitas al menos dos bodegas activas para crear un traslado interno.</div>}
        </div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Historial de despachos</h2><p>Últimos 100 despachos y su relación con Guía de Despacho Electrónica tipo 52.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Fecha</th><th>Despacho</th><th>Origen → destino</th><th>Referencia</th><th>Líneas</th><th>Guía 52</th><th>Estado</th></tr></thead>
          <tbody>
            {dispatches.length === 0 && <tr><td colSpan={7}>Aún no existen despachos.</td></tr>}
            {dispatches.map((dispatch) => {
              const guide = dispatch.dteDocuments[0] ?? null;
              return <tr key={dispatch.id}>
                <td>{dispatch.createdAt.toLocaleString("es-CL")}</td>
                <td><Link href={`/admin/despachos/${dispatch.id}`}><strong>{dispatch.dispatchNumber}</strong></Link><small>{typeLabel[dispatch.type]}</small></td>
                <td>{dispatch.sourceWarehouse.name}<small>→ {dispatch.destinationWarehouse?.name ?? dispatch.receiverName}</small></td>
                <td>{dispatch.sale ? <Link href={`/admin/pos/ventas/${dispatch.sale.id}`}>{dispatch.sale.saleNumber}</Link> : dispatch.order?.orderNumber ?? "—"}</td>
                <td>{dispatch._count.items}</td>
                <td>{guide ? <Link href={`/admin/facturacion/${guide.id}`}>Folio {guide.folio}<small>{guide.status}</small></Link> : "Pendiente"}</td>
                <td><span className={`billing-status is-${dispatch.status.toLowerCase()}`}>{statusLabel[dispatch.status]}</span></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </section>

      <div className="billing-legal-note">
        <strong>Validación SII</strong>
        <span>La estructura tipo 52 y los campos logísticos quedan integrados al gateway, pero los códigos de traslado y el XML definitivo deben validarse contra la certificación/especificación SII vigente antes de activar producción.</span>
      </div>
    </div>
  );
}
