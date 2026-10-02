import Link from "next/link";
import { DispatchStatus, DispatchType, DteStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import {
  cancelDispatchAction,
  issueDispatchGuideAction,
  markDispatchDispatchedAction,
  markDispatchReceivedAction,
} from "@/app/admin/dispatch-actions";
import { PrintButton } from "@/components/admin/print-button";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { formatQuantity } from "@/lib/quantity";

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
  INTERNAL_TRANSFER: "Traslado interno entre bodegas",
  OTHER: "Otro traslado",
};

function guideCanMove(status: DteStatus): boolean {
  return status === DteStatus.GENERATED
    || status === DteStatus.QUEUED
    || status === DteStatus.SENT
    || status === DteStatus.ACCEPTED
    || status === DteStatus.OBSERVED;
}

export default async function DispatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const dispatch = await prisma.dispatch.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      sale: true,
      order: true,
      items: { orderBy: { productName: "asc" } },
      dteDocuments: { where: { typeCode: 52 }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!dispatch) notFound();

  const guide = dispatch.dteDocuments[0] ?? null;
  const activeGuide = dispatch.dteDocuments.find((item) => item.status !== DteStatus.CANCELLED && item.status !== DteStatus.REJECTED) ?? null;
  const total = dispatch.items.reduce((sum, item) => sum + item.amount, 0);
  const canDispatch = dispatch.status !== DispatchStatus.DISPATCHED
    && dispatch.status !== DispatchStatus.RECEIVED
    && dispatch.status !== DispatchStatus.CANCELLED
    && Boolean(guide && guideCanMove(guide.status));

  return (
    <div className="admin-content admin-content-narrow dispatch-detail-page">
      <div className="pos-receipt-actions no-print">
        <Link href="/admin/despachos" className="admin-button admin-button-secondary">← Despachos</Link>
        <div className="pos-receipt-action-group">
          {guide && <Link href={`/admin/facturacion/${guide.id}`} className="admin-button admin-button-secondary">Ver Guía 52</Link>}
          <PrintButton />
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card">
        <div className="admin-title-row">
          <div><span className="admin-kicker">{typeLabel[dispatch.type]}</span><h1>{dispatch.dispatchNumber}</h1><p>{dispatch.reason}</p></div>
          <span className={`billing-status is-${dispatch.status.toLowerCase()}`}>{statusLabel[dispatch.status]}</span>
        </div>

        <div className="pos-receipt-meta">
          <div><span>Origen</span><strong>{dispatch.sourceWarehouse.code} · {dispatch.sourceWarehouse.name}</strong><small>{dispatch.sourceWarehouse.address ?? "Sin dirección registrada"}</small></div>
          <div><span>Destino</span><strong>{dispatch.destinationWarehouse ? `${dispatch.destinationWarehouse.code} · ${dispatch.destinationWarehouse.name}` : dispatch.receiverName}</strong><small>{dispatch.receiverAddress} · {dispatch.receiverCommune}</small></div>
          <div><span>Creado</span><strong>{dispatch.createdAt.toLocaleString("es-CL")}</strong></div>
          <div><span>Salida</span><strong>{dispatch.dispatchedAt ? dispatch.dispatchedAt.toLocaleString("es-CL") : "Pendiente"}</strong></div>
          <div><span>Recepción</span><strong>{dispatch.receivedAt ? dispatch.receivedAt.toLocaleString("es-CL") : "Pendiente"}</strong></div>
          <div><span>Referencia</span><strong>{dispatch.sale?.saleNumber ?? dispatch.order?.orderNumber ?? "Sin documento comercial"}</strong></div>
        </div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Documento tributario</h2><p>La Guía de Despacho 52 se emite sin modificar stock. El movimiento físico ocurre al confirmar salida/recepción.</p></div></div>
        {guide ? (
          <div className={`pos-dte-banner is-${guide.status.toLowerCase()}`}>
            <div><span>Guía de Despacho Electrónica</span><strong>Tipo 52 · Folio {guide.folio}</strong><small>{guide.environment}{guide.trackId ? ` · Track ${guide.trackId}` : ""}</small></div>
            <div><strong>{guide.status}</strong><Link href={`/admin/facturacion/${guide.id}`}>Abrir DTE</Link></div>
          </div>
        ) : (
          <div>
            <p>Aún no se ha generado la guía electrónica para este despacho.</p>
            {dispatch.status !== DispatchStatus.CANCELLED && <form action={issueDispatchGuideAction}>
              <input type="hidden" name="dispatchId" value={dispatch.id} />
              <button className="admin-button admin-button-primary" type="submit">Emitir Guía de Despacho 52</button>
            </form>}
          </div>
        )}
        {activeGuide?.status === DteStatus.ERROR && <div className="admin-alert admin-alert-error">La guía quedó con error de integración. Ábrela en Facturación SII y utiliza Reenviar; el stock todavía no se moverá.</div>}
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Mercadería</h2><p>{dispatch.type === DispatchType.INTERNAL_TRANSFER ? "Al salir se descuenta de origen. Al recibir se incorpora al destino como stock sin ubicar en WMS." : "Despacho asociado a mercadería cuya venta ya fue descontada del inventario."}</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Producto</th><th>Cantidad / peso</th><th>Precio referencia</th><th>Monto referencia</th></tr></thead>
          <tbody>{dispatch.items.map((item) => <tr key={item.id}>
            <td><strong>{item.productName}</strong></td>
            <td>{formatQuantity(item.quantity, item.unit)}</td>
            <td>{formatClp(item.unitPrice)} / {item.unit === "KG" ? "kg" : "un."}</td>
            <td>{formatClp(item.amount)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th colSpan={3}>Total referencial</th><th>{formatClp(total)}</th></tr></tfoot>
        </table></div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Transporte</h2><p>Datos operativos conservados junto al despacho y enviados al adaptador DTE cuando correspondan.</p></div></div>
        <div className="pos-receipt-meta">
          <div><span>Receptor</span><strong>{dispatch.receiverName}</strong><small>{dispatch.receiverRut ?? "RUT pendiente"}</small></div>
          <div><span>Giro</span><strong>{dispatch.receiverGiro ?? "—"}</strong></div>
          <div><span>Código traslado</span><strong>{dispatch.transferReasonCode ?? "Pendiente"}</strong></div>
          <div><span>Vehículo</span><strong>{dispatch.vehiclePlate ?? "—"}</strong><small>{dispatch.trailerPlate ? `Remolque ${dispatch.trailerPlate}` : ""}</small></div>
          <div><span>Transportista</span><strong>{dispatch.transportCompanyName ?? "—"}</strong><small>{dispatch.transportCompanyRut ?? ""}</small></div>
          <div><span>Conductor</span><strong>{dispatch.driverName ?? "—"}</strong><small>{dispatch.driverRut ?? ""}</small></div>
        </div>
        {dispatch.notes && <div className="pos-receipt-notes"><strong>Observaciones</strong><p>{dispatch.notes}</p></div>}
      </section>

      <section className="admin-card pos-management-section no-print">
        <div className="admin-card-heading"><div><h2>Operación logística</h2><p>Estos botones cambian el estado físico. El traslado interno mueve inventario únicamente en salida y recepción.</p></div></div>
        <div className="pos-page-actions">
          {canDispatch && <form action={markDispatchDispatchedAction}><input type="hidden" name="dispatchId" value={dispatch.id} /><button className="admin-button admin-button-primary" type="submit">Confirmar salida / Despachar</button></form>}
          {dispatch.status === DispatchStatus.DISPATCHED && <form action={markDispatchReceivedAction}><input type="hidden" name="dispatchId" value={dispatch.id} /><button className="admin-button admin-button-primary" type="submit">Confirmar recepción</button></form>}
          {(dispatch.status === DispatchStatus.DRAFT || dispatch.status === DispatchStatus.READY) && !activeGuide && <form action={cancelDispatchAction}><input type="hidden" name="dispatchId" value={dispatch.id} /><button className="admin-button admin-button-secondary" type="submit">Cancelar despacho</button></form>}
        </div>
      </section>

      <div className="billing-legal-note">
        <strong>Control operativo</strong>
        <span>Emitir la guía no altera existencias. Para traslados internos, “Despachar” genera TRANSFER_OUT y “Recibir” genera TRANSFER_IN. La recepción queda sin ubicación WMS hasta asignarla físicamente.</span>
      </div>
    </div>
  );
}
