import Link from "next/link";
import { PosPaymentMethod } from "@prisma/client";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/admin/print-button";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const paymentLabels: Record<PosPaymentMethod, string> = {
  CASH: "Efectivo",
  DEBIT_CARD: "Tarjeta débito",
  CREDIT_CARD: "Tarjeta crédito",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

function unitLabel(unit: string): string {
  return unit === "KG" ? "kg" : "un.";
}

export default async function PosSaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sale = await prisma.posSale.findUnique({
    where: { id },
    include: {
      warehouse: true,
      cashierUser: true,
      shift: { include: { register: true, user: true } },
      items: { orderBy: { productName: "asc" } },
    },
  });
  if (!sale) notFound();

  return (
    <div className="admin-content admin-content-narrow pos-receipt-page">
      <div className="pos-receipt-actions no-print">
        <Link href={sale.shiftId ? `/admin/pos?shift=${sale.shiftId}` : "/admin/pos"} className="admin-button admin-button-secondary">← Volver al POS</Link>
        <PrintButton />
      </div>

      <article className="pos-receipt">
        <header>
          <span className="admin-kicker">Renacer Distribuidora</span>
          <h1>Comprobante de venta</h1>
          <strong>{sale.saleNumber}</strong>
          <p>{sale.createdAt.toLocaleString("es-CL")}</p>
        </header>

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
          <div className="pos-receipt-row pos-receipt-row-head"><span>Producto</span><span>Cant.</span><span>Precio</span><span>Total</span></div>
          {sale.items.map((item) => (
            <div className="pos-receipt-row" key={item.id}>
              <span><strong>{item.productName}</strong><small>{unitLabel(item.unit)}</small></span>
              <span>{item.quantity}</span>
              <span>{formatClp(item.unitPrice)}</span>
              <span>{formatClp(item.subtotal)}</span>
            </div>
          ))}
        </section>

        <section className="pos-receipt-totals">
          <div><span>Subtotal</span><strong>{formatClp(sale.subtotal)}</strong></div>
          {sale.discount > 0 && <div><span>Descuento</span><strong>−{formatClp(sale.discount)}</strong></div>}
          <div className="pos-receipt-total"><span>Total</span><strong>{formatClp(sale.total)}</strong></div>
          {sale.paymentMethod === "CASH" && <>
            <div><span>Recibido</span><strong>{formatClp(sale.amountReceived ?? sale.total)}</strong></div>
            <div><span>Vuelto</span><strong>{formatClp(sale.changeDue)}</strong></div>
          </>}
        </section>

        {sale.notes && <section className="pos-receipt-notes"><strong>Observación</strong><p>{sale.notes}</p></section>}
        <footer>Documento interno de venta presencial · Renacer Distribuidora</footer>
      </article>
    </div>
  );
}
