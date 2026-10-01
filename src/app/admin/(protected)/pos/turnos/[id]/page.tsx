import Link from "next/link";
import { PosCashMovementType, PosPaymentMethod } from "@prisma/client";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/admin/print-button";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const paymentLabels: Record<PosPaymentMethod, string> = {
  CASH: "Efectivo",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

export default async function PosShiftReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shift = await prisma.posShift.findUnique({
    where: { id },
    include: {
      register: { include: { warehouse: true } },
      user: true,
      sales: { include: { _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } },
      cashMovements: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!shift) notFound();

  const paymentTotals = new Map<PosPaymentMethod, { count: number; total: number }>();
  for (const sale of shift.sales) {
    const current = paymentTotals.get(sale.paymentMethod) ?? { count: 0, total: 0 };
    paymentTotals.set(sale.paymentMethod, { count: current.count + 1, total: current.total + sale.total });
  }
  const salesTotal = shift.sales.reduce((sum, sale) => sum + sale.total, 0);
  const discounts = shift.sales.reduce((sum, sale) => sum + sale.discount, 0);
  const cashSales = paymentTotals.get(PosPaymentMethod.CASH)?.total ?? 0;
  const cashIn = shift.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_IN).reduce((sum, movement) => sum + movement.amount, 0);
  const cashOut = shift.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_OUT).reduce((sum, movement) => sum + movement.amount, 0);
  const expectedCash = shift.expectedCash ?? shift.openingAmount + cashSales + cashIn - cashOut;

  return (
    <div className="admin-content pos-admin-page pos-shift-report-page">
      <div className="pos-receipt-actions no-print">
        <Link href="/admin/pos/reportes" className="admin-button admin-button-secondary">← Volver a reportes</Link>
        <PrintButton />
      </div>

      <article className="admin-card pos-shift-report">
        <header className="pos-shift-report-header">
          <div><span className="admin-kicker">Renacer Distribuidora · POS</span><h1>Reporte de turno de caja</h1><p>Turno {shift.id.slice(-8).toUpperCase()}</p></div>
          <div className={`pos-shift-status ${shift.status === "OPEN" ? "is-open" : "is-closed"}`}>{shift.status === "OPEN" ? "ABIERTO" : "CERRADO"}</div>
        </header>

        <section className="pos-shift-report-meta">
          <div><span>Caja</span><strong>{shift.register.code} · {shift.register.name}</strong></div>
          <div><span>Bodega</span><strong>{shift.register.warehouse.code} · {shift.register.warehouse.name}</strong></div>
          <div><span>Cajero</span><strong>{shift.user.name}</strong><small>{shift.user.username}</small></div>
          <div><span>Apertura</span><strong>{shift.openedAt.toLocaleString("es-CL")}</strong></div>
          <div><span>Cierre</span><strong>{shift.closedAt ? shift.closedAt.toLocaleString("es-CL") : "Turno en curso"}</strong></div>
          <div><span>Fondo inicial</span><strong>{formatClp(shift.openingAmount)}</strong></div>
        </section>

        <section className="admin-stats-grid pos-shift-report-stats">
          <div className="admin-stat"><strong>{shift.sales.length}</strong><span>ventas</span></div>
          <div className="admin-stat"><strong>{formatClp(salesTotal)}</strong><span>venta total</span></div>
          <div className="admin-stat"><strong>{formatClp(discounts)}</strong><span>descuentos</span></div>
          <div className="admin-stat"><strong>{formatClp(cashSales)}</strong><span>ventas efectivo</span></div>
        </section>

        <section className="pos-shift-report-grid">
          <div className="pos-shift-report-block">
            <h2>Medios de pago</h2>
            {Object.values(PosPaymentMethod).map((method) => {
              const value = paymentTotals.get(method) ?? { count: 0, total: 0 };
              return <div key={method}><span>{paymentLabels[method]} <small>({value.count})</small></span><strong>{formatClp(value.total)}</strong></div>;
            })}
          </div>
          <div className="pos-shift-report-block">
            <h2>Arqueo de efectivo</h2>
            <div><span>Fondo inicial</span><strong>{formatClp(shift.openingAmount)}</strong></div>
            <div><span>Ventas en efectivo</span><strong>{formatClp(cashSales)}</strong></div>
            <div><span>Ingresos</span><strong>+{formatClp(cashIn)}</strong></div>
            <div><span>Retiros</span><strong>−{formatClp(cashOut)}</strong></div>
            <div className="is-total"><span>Efectivo esperado</span><strong>{formatClp(expectedCash)}</strong></div>
            <div><span>Efectivo declarado</span><strong>{shift.declaredCash === null ? "—" : formatClp(shift.declaredCash)}</strong></div>
            <div className={`is-difference${(shift.difference ?? 0) !== 0 ? " has-difference" : ""}`}><span>Diferencia</span><strong>{shift.difference === null ? "—" : formatClp(shift.difference)}</strong></div>
          </div>
        </section>

        <section className="pos-management-section">
          <h2>Movimientos de efectivo</h2>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Motivo</th></tr></thead><tbody>
            {shift.cashMovements.length === 0 && <tr><td colSpan={4}>Sin movimientos adicionales.</td></tr>}
            {shift.cashMovements.map((movement) => <tr key={movement.id}><td>{movement.createdAt.toLocaleString("es-CL")}</td><td>{movement.type === PosCashMovementType.CASH_IN ? "Ingreso" : "Retiro"}</td><td>{movement.type === PosCashMovementType.CASH_IN ? "+" : "−"}{formatClp(movement.amount)}</td><td>{movement.reason}</td></tr>)}
          </tbody></table></div>
        </section>

        <section className="pos-management-section">
          <h2>Ventas del turno</h2>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Hora</th><th>N° venta</th><th>Pago</th><th>Líneas</th><th>Descuento</th><th>Total</th></tr></thead><tbody>
            {shift.sales.length === 0 && <tr><td colSpan={6}>Sin ventas en este turno.</td></tr>}
            {shift.sales.map((sale) => <tr key={sale.id}><td>{sale.createdAt.toLocaleString("es-CL")}</td><td><Link href={`/admin/pos/ventas/${sale.id}`}>{sale.saleNumber}</Link></td><td>{paymentLabels[sale.paymentMethod]}</td><td>{sale._count.items}</td><td>{formatClp(sale.discount)}</td><td><strong>{formatClp(sale.total)}</strong></td></tr>)}
          </tbody></table></div>
        </section>

        {(shift.openingNotes || shift.closingNotes) && <section className="pos-shift-report-notes"><h2>Observaciones</h2>{shift.openingNotes && <p><strong>Apertura:</strong> {shift.openingNotes}</p>}{shift.closingNotes && <p><strong>Cierre:</strong> {shift.closingNotes}</p>}</section>}
      </article>
    </div>
  );
}
