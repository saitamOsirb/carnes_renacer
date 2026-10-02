import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  DteDocumentType,
  DteStatus,
  PosPaymentMethod,
  PosShiftStatus,
} from "@prisma/client";
import { notFound } from "next/navigation";
import {
  createPosReturnAction,
  issuePosReturnCreditNoteAction,
} from "@/app/admin/pos-return-actions";
import { PrintButton } from "@/components/admin/print-button";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { formatQuantity, roundQuantity, toQuantityNumber } from "@/lib/quantity";
import { dteTypeLabel } from "@/lib/sii/billing-service";

export const dynamic = "force-dynamic";

const paymentLabels: Record<PosPaymentMethod, string> = {
  CASH: "Efectivo",
  DEBIT_CARD: "Tarjeta débito",
  CREDIT_CARD: "Tarjeta crédito",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

function isOriginalDte(type: DteDocumentType): boolean {
  return type === DteDocumentType.BOLETA_ELECTRONICA || type === DteDocumentType.FACTURA_ELECTRONICA;
}

function isActiveDteStatus(status: DteStatus): boolean {
  return status !== DteStatus.CANCELLED && status !== DteStatus.REJECTED;
}

export default async function PosSaleReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; return?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const sale = await prisma.posSale.findUnique({
    where: { id },
    include: {
      warehouse: true,
      cashierUser: true,
      shift: { include: { register: true, user: true } },
      items: {
        orderBy: { productName: "asc" },
        include: { returnItems: true },
      },
      returns: {
        orderBy: { createdAt: "desc" },
        include: {
          items: { orderBy: { productName: "asc" } },
          shift: { include: { register: true, user: true } },
          dteDocuments: { orderBy: { createdAt: "desc" } },
        },
      },
      dteDocuments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!sale) notFound();

  const openShifts = await prisma.posShift.findMany({
    where: {
      status: PosShiftStatus.OPEN,
      register: { warehouseId: sale.warehouseId, active: true },
      user: { active: true },
    },
    include: { register: true, user: true },
    orderBy: { openedAt: "desc" },
  });

  const originalDte = sale.dteDocuments.find((document) => isOriginalDte(document.type) && isActiveDteStatus(document.status)) ?? null;
  const returnedTotal = sale.returns.reduce((sum, item) => sum + item.totalAmount, 0);
  const remainingPaid = Math.max(0, sale.total - returnedTotal);
  const lines = sale.items.map((item) => {
    const returned = roundQuantity(item.returnItems.reduce((sum, returnedItem) => sum + toQuantityNumber(returnedItem.quantity), 0));
    const sold = toQuantityNumber(item.quantity);
    return { item, sold, returned, remaining: roundQuantity(Math.max(0, sold - returned)) };
  });
  const fullyReturned = lines.every((line) => line.remaining <= 0);
  const requestKey = randomUUID().replaceAll("-", "_");

  return (
    <div className="admin-content admin-content-narrow pos-receipt-page">
      <div className="pos-receipt-actions no-print">
        <Link href={sale.shiftId ? `/admin/pos?shift=${sale.shiftId}` : "/admin/pos"} className="admin-button admin-button-secondary">← Volver al POS</Link>
        <div className="pos-receipt-action-group">
          {originalDte ? <Link href={`/admin/facturacion/${originalDte.id}`} className="admin-button admin-button-secondary">Ver DTE original</Link> : <Link href="/admin/facturacion" className="admin-button admin-button-secondary">Emitir boleta / factura</Link>}
          <PrintButton />
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok no-print">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error no-print">{query.error}</div>}

      {originalDte && <section className={`pos-dte-banner is-${originalDte.status.toLowerCase()}`}><div><span>Documento tributario original</span><strong>{dteTypeLabel(originalDte.type)} · Folio {originalDte.folio}</strong><small>{originalDte.environment}{originalDte.trackId ? ` · Track ${originalDte.trackId}` : ""}</small></div><strong>{originalDte.status}</strong></section>}

      <article className="pos-receipt">
        <header><span className="admin-kicker">Renacer Distribuidora</span><h1>Comprobante de venta</h1><strong>{sale.saleNumber}</strong><p>{sale.createdAt.toLocaleString("es-CL")}</p></header>

        <section className="pos-receipt-meta">
          {sale.shift?.register && <div><span>Caja</span><strong>{sale.shift.register.code} · {sale.shift.register.name}</strong></div>}
          <div><span>Bodega</span><strong>{sale.warehouse.code} · {sale.warehouse.name}</strong></div>
          <div><span>Cajero</span><strong>{sale.shift?.user.name ?? sale.cashierUser?.name ?? sale.cashier}</strong></div>
          {sale.shiftId && <div><span>Turno</span><strong>{sale.shiftId.slice(-8).toUpperCase()}</strong></div>}
          <div><span>Medio de pago</span><strong>{paymentLabels[sale.paymentMethod]}</strong></div>
          {sale.customerName && <div><span>Cliente</span><strong>{sale.customerName}</strong></div>}
          {sale.customerRut && <div><span>RUT</span><strong>{sale.customerRut}</strong></div>}
        </section>

        <section className="pos-receipt-lines">
          <div className="pos-receipt-row pos-receipt-row-head"><span>Producto</span><span>Cant./peso</span><span>Precio</span><span>Total</span></div>
          {sale.items.map((item) => <div className="pos-receipt-row" key={item.id}>
            <span><strong>{item.productName}</strong><small>{item.unit === "KG" ? "Precio por kg" : "Precio por unidad"}</small></span>
            <span>{formatQuantity(item.quantity, item.unit)}</span>
            <span>{formatClp(item.unitPrice)}</span>
            <span>{formatClp(item.subtotal)}</span>
          </div>)}
        </section>

        <section className="pos-receipt-totals">
          <div><span>Subtotal</span><strong>{formatClp(sale.subtotal)}</strong></div>
          {sale.discount > 0 && <div><span>Descuento</span><strong>−{formatClp(sale.discount)}</strong></div>}
          <div className="pos-receipt-total"><span>Total</span><strong>{formatClp(sale.total)}</strong></div>
          {returnedTotal > 0 && <><div><span>Devuelto</span><strong>−{formatClp(returnedTotal)}</strong></div><div><span>Saldo neto venta</span><strong>{formatClp(remainingPaid)}</strong></div></>}
          {sale.paymentMethod === "CASH" && <><div><span>Recibido</span><strong>{formatClp(sale.amountReceived ?? sale.total)}</strong></div><div><span>Vuelto original</span><strong>{formatClp(sale.changeDue)}</strong></div></>}
        </section>

        {sale.notes && <section className="pos-receipt-notes"><strong>Observación</strong><p>{sale.notes}</p></section>}
        <footer>{originalDte ? `Venta asociada a ${dteTypeLabel(originalDte.type)} folio ${originalDte.folio} · Estado ${originalDte.status}` : "Documento interno de venta presencial · Sin DTE original asociado todavía"}</footer>
      </article>

      <section className="admin-card no-print" style={{ marginTop: 24 }}>
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">Postventa</span>
            <h2>Devolución de productos</h2>
            <p>El stock vuelve a {sale.warehouse.name} como stock sin ubicar. Nunca se modifica la venta original.</p>
          </div>
          <div className="admin-stat"><strong>{formatClp(returnedTotal)}</strong><span>devuelto</span></div>
        </div>

        {fullyReturned ? (
          <div className="admin-alert admin-alert-ok">Venta completamente devuelta. No quedan cantidades pendientes.</div>
        ) : openShifts.length === 0 ? (
          <div className="admin-alert admin-alert-error">No existe un turno abierto en una caja de {sale.warehouse.name}. Abre un turno antes de procesar la devolución.</div>
        ) : (
          <form action={createPosReturnAction} className="admin-form">
            <input type="hidden" name="saleId" value={sale.id} />
            <input type="hidden" name="requestKey" value={requestKey} />

            <div className="admin-grid admin-grid-2">
              <label>Turno que procesa el reembolso
                <select name="shiftId" required defaultValue={openShifts[0]?.id}>
                  {openShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.register.code} · {shift.register.name} · {shift.user.name}</option>)}
                </select>
              </label>
              <label>Motivo de devolución
                <input name="reason" required minLength={3} maxLength={500} placeholder="Ej: producto devuelto por cliente" />
              </label>
            </div>

            <div className="admin-table-wrap" style={{ marginTop: 16 }}>
              <table className="admin-table">
                <thead><tr><th>Producto</th><th>Vendido</th><th>Ya devuelto</th><th>Saldo</th><th>Devolver ahora</th></tr></thead>
                <tbody>
                  {lines.map(({ item, sold, returned, remaining }) => <tr key={item.id}>
                    <td><strong>{item.productName}</strong><br /><small>{formatClp(item.unitPrice)} / {item.unit === "KG" ? "kg" : "un."}</small></td>
                    <td>{formatQuantity(sold, item.unit)}</td>
                    <td>{formatQuantity(returned, item.unit)}</td>
                    <td><strong>{formatQuantity(remaining, item.unit)}</strong></td>
                    <td>{remaining > 0 ? <input name={`qty_${item.id}`} type="number" min="0" max={remaining} step={item.unit === "KG" ? "0.001" : "1"} defaultValue="0" style={{ maxWidth: 130 }} /> : <span>Completo</span>}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>

            <div className="admin-inline-notice" style={{ marginTop: 16 }}>
              {sale.paymentMethod === PosPaymentMethod.CASH
                ? "El monto reembolsado se registrará automáticamente como salida de efectivo del turno seleccionado."
                : `La devolución quedará registrada con medio ${paymentLabels[sale.paymentMethod]}. La reversa bancaria/Transbank debe ejecutarse en el proveedor de pago cuando corresponda.`}
            </div>

            {originalDte ? <label className="admin-checks" style={{ marginTop: 14 }}><span><input type="checkbox" name="issueCreditNote" defaultChecked /> Emitir Nota de Crédito 61 referenciada al {dteTypeLabel(originalDte.type)} folio {originalDte.folio}</span></label> : <div className="admin-inline-notice" style={{ marginTop: 14 }}>Esta venta todavía no tiene boleta/factura original; la devolución puede registrarse, pero no se emitirá NC 61 hasta disponer del DTE de origen.</div>}

            <button className="admin-button admin-button-danger" type="submit" style={{ marginTop: 16 }}>Registrar devolución</button>
          </form>
        )}
      </section>

      {sale.returns.length > 0 && <section className="admin-card no-print" style={{ marginTop: 24 }}>
        <div className="admin-card-heading"><div><span className="admin-kicker">Auditoría</span><h2>Historial de devoluciones</h2></div></div>
        <div style={{ display: "grid", gap: 16 }}>
          {sale.returns.map((posReturn) => {
            const creditNote = posReturn.dteDocuments.find((document) => document.type === DteDocumentType.NOTA_CREDITO && isActiveDteStatus(document.status)) ?? null;
            return <article key={posReturn.id} className="admin-inline-notice" id={query.return === posReturn.id ? "devolucion-seleccionada" : undefined}>
              <div className="admin-title-row" style={{ marginBottom: 10 }}>
                <div><strong>{posReturn.returnNumber}</strong><br /><small>{posReturn.createdAt.toLocaleString("es-CL")} · {posReturn.shift?.register.name ?? "Caja"} · {posReturn.shift?.user.name ?? "Usuario"}</small></div>
                <div><strong>{formatClp(posReturn.totalAmount)}</strong><br /><small>{paymentLabels[posReturn.refundMethod]}</small></div>
              </div>
              <p><strong>Motivo:</strong> {posReturn.reason}</p>
              <ul style={{ margin: "8px 0 12px", paddingLeft: 20 }}>
                {posReturn.items.map((item) => <li key={item.id}>{item.productName}: {formatQuantity(item.quantity, item.unit)} · {formatClp(item.totalAmount)}</li>)}
              </ul>
              <small>Bruto {formatClp(posReturn.grossAmount)} · descuento proporcional {formatClp(posReturn.discountAmount)} · reembolso {formatClp(posReturn.totalAmount)}{posReturn.cashMovementId ? " · salida de caja registrada" : ""}</small>
              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {creditNote ? <Link className="admin-button admin-button-secondary" href={`/admin/facturacion/${creditNote.id}`}>NC 61 folio {creditNote.folio} · {creditNote.status}</Link> : originalDte ? <form action={issuePosReturnCreditNoteAction}>
                  <input type="hidden" name="saleId" value={sale.id} />
                  <input type="hidden" name="returnId" value={posReturn.id} />
                  <input type="hidden" name="parentDocumentId" value={originalDte.id} />
                  <button className="admin-button admin-button-secondary" type="submit">Emitir NC 61 pendiente</button>
                </form> : <span>Sin DTE original para emitir NC</span>}
              </div>
            </article>;
          })}
        </div>
      </section>}
    </div>
  );
}
