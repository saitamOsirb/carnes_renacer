import Link from "next/link";
import { PosCashMovementType, PosPaymentMethod, PosShiftStatus, Prisma } from "@prisma/client";
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

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function safeDate(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function addGroup(map: Map<string, { count: number; total: number }>, key: string, amount: number): void {
  const current = map.get(key) ?? { count: 0, total: 0 };
  map.set(key, { count: current.count + 1, total: current.total + amount });
}

export default async function PosReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; registerId?: string; userId?: string }> }) {
  const query = await searchParams;
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const from = safeDate(query.from, dateValue(monthAgo));
  const to = safeDate(query.to, dateValue(today));
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T23:59:59.999`);

  const shiftFilter: Prisma.PosShiftWhereInput = {
    openedAt: { gte: fromDate, lte: toDate },
    ...(query.registerId ? { registerId: query.registerId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
  };
  const relationFilter: Prisma.PosShiftWhereInput = {
    ...(query.registerId ? { registerId: query.registerId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
  };
  const saleFilter: Prisma.PosSaleWhereInput = {
    createdAt: { gte: fromDate, lte: toDate },
    ...((query.registerId || query.userId) ? { shift: { is: relationFilter } } : {}),
  };

  const [registers, users, sales, shifts] = await Promise.all([
    prisma.cashRegister.findMany({ orderBy: { name: "asc" } }),
    prisma.posUser.findMany({ orderBy: { name: "asc" } }),
    prisma.posSale.findMany({
      where: saleFilter,
      include: { shift: { include: { register: true, user: true } }, cashierUser: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.posShift.findMany({
      where: shiftFilter,
      include: {
        register: true,
        user: true,
        sales: { select: { total: true, discount: true, paymentMethod: true } },
        cashMovements: { select: { type: true, amount: true } },
      },
      orderBy: { openedAt: "desc" },
      take: 1000,
    }),
  ]);

  const salesTotal = sales.reduce((sum, sale) => sum + sale.total, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + sale.discount, 0);
  const averageTicket = sales.length > 0 ? Math.round(salesTotal / sales.length) : 0;
  const paymentTotals = new Map<PosPaymentMethod, { count: number; total: number }>();
  const registerTotals = new Map<string, { count: number; total: number }>();
  const userTotals = new Map<string, { count: number; total: number }>();

  for (const sale of sales) {
    const payment = paymentTotals.get(sale.paymentMethod) ?? { count: 0, total: 0 };
    paymentTotals.set(sale.paymentMethod, { count: payment.count + 1, total: payment.total + sale.total });
    addGroup(registerTotals, sale.shift?.register.name ?? "Ventas POS anteriores", sale.total);
    addGroup(userTotals, sale.shift?.user.name ?? sale.cashierUser?.name ?? sale.cashier, sale.total);
  }

  const closedShifts = shifts.filter((shift) => shift.status === PosShiftStatus.CLOSED);
  const totalDifference = closedShifts.reduce((sum, shift) => sum + (shift.difference ?? 0), 0);

  return (
    <div className="admin-content pos-admin-page">
      <div className="admin-title-row">
        <div><span className="admin-kicker">POS</span><h1>Reportes de cajas y ventas</h1><p>Consolidado por período, caja, cajero, turno y medio de pago.</p></div>
        <div className="pos-page-actions"><Link className="admin-button admin-button-secondary" href="/admin/pos">POS</Link><Link className="admin-button admin-button-secondary" href="/admin/pos/configuracion">Configuración</Link></div>
      </div>

      <form className="admin-card pos-report-filters" method="get">
        <label>Desde<input type="date" name="from" defaultValue={from} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={to} /></label>
        <label>Caja<select name="registerId" defaultValue={query.registerId ?? ""}><option value="">Todas</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.code} · {register.name}</option>)}</select></label>
        <label>Usuario<select name="userId" defaultValue={query.userId ?? ""}><option value="">Todos</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <button className="admin-button admin-button-primary" type="submit">Aplicar filtros</button>
      </form>

      <section className="admin-stats-grid pos-report-stats">
        <div className="admin-stat"><strong>{sales.length}</strong><span>ventas</span></div>
        <div className="admin-stat"><strong>{formatClp(salesTotal)}</strong><span>venta total</span></div>
        <div className="admin-stat"><strong>{formatClp(averageTicket)}</strong><span>ticket promedio</span></div>
        <div className="admin-stat"><strong>{formatClp(discountTotal)}</strong><span>descuentos</span></div>
        <div className="admin-stat"><strong>{shifts.length}</strong><span>turnos abiertos/cerrados</span></div>
        <div className={`admin-stat${totalDifference !== 0 ? " admin-stat-warning" : ""}`}><strong>{formatClp(totalDifference)}</strong><span>diferencia de cierres</span></div>
      </section>

      <section className="admin-operation-grid pos-report-columns">
        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Por medio de pago</h2><p>Importe y cantidad de transacciones.</p></div></div>
          <div className="pos-report-list">{Object.values(PosPaymentMethod).map((method) => { const value = paymentTotals.get(method) ?? { count: 0, total: 0 }; return <div key={method}><span>{paymentLabels[method]}<small>{value.count} ventas</small></span><strong>{formatClp(value.total)}</strong></div>; })}</div>
        </div>
        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Por caja</h2><p>Ventas asociadas a cada caja.</p></div></div>
          <div className="pos-report-list">{[...registerTotals.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, value]) => <div key={name}><span>{name}<small>{value.count} ventas</small></span><strong>{formatClp(value.total)}</strong></div>)}</div>
        </div>
        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Por cajero</h2><p>Ventas registradas por usuario.</p></div></div>
          <div className="pos-report-list">{[...userTotals.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, value]) => <div key={name}><span>{name}<small>{value.count} ventas</small></span><strong>{formatClp(value.total)}</strong></div>)}</div>
        </div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Turnos de caja</h2><p>Apertura, venta, movimientos de efectivo y diferencias de cierre.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Apertura / cierre</th><th>Caja</th><th>Cajero</th><th>Ventas</th><th>Apertura</th><th>Efectivo vendido</th><th>Ingresos</th><th>Retiros</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th></tr></thead><tbody>
          {shifts.length === 0 && <tr><td colSpan={11}>No hay turnos para los filtros seleccionados.</td></tr>}
          {shifts.map((shift) => {
            const cashSales = shift.sales.filter((sale) => sale.paymentMethod === PosPaymentMethod.CASH).reduce((sum, sale) => sum + sale.total, 0);
            const cashIn = shift.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_IN).reduce((sum, movement) => sum + movement.amount, 0);
            const cashOut = shift.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_OUT).reduce((sum, movement) => sum + movement.amount, 0);
            const expected = shift.expectedCash ?? shift.openingAmount + cashSales + cashIn - cashOut;
            const totalSales = shift.sales.reduce((sum, sale) => sum + sale.total, 0);
            return <tr key={shift.id}><td>{shift.openedAt.toLocaleString("es-CL")}<small>{shift.closedAt ? `Cierre: ${shift.closedAt.toLocaleString("es-CL")}` : "Turno abierto"}</small></td><td>{shift.register.code}<small>{shift.register.name}</small></td><td>{shift.user.name}</td><td>{formatClp(totalSales)}<small>{shift.sales.length} ventas</small></td><td>{formatClp(shift.openingAmount)}</td><td>{formatClp(cashSales)}</td><td>{formatClp(cashIn)}</td><td>{formatClp(cashOut)}</td><td><strong>{formatClp(expected)}</strong></td><td>{shift.declaredCash === null ? "—" : formatClp(shift.declaredCash)}</td><td className={(shift.difference ?? 0) < 0 ? "admin-qty-negative" : (shift.difference ?? 0) > 0 ? "admin-qty-positive" : ""}>{shift.difference === null ? "—" : formatClp(shift.difference)}</td></tr>;
          })}
        </tbody></table></div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Detalle de ventas</h2><p>Hasta 5.000 operaciones del período seleccionado.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Fecha</th><th>N° venta</th><th>Caja</th><th>Cajero</th><th>Pago</th><th>Subtotal</th><th>Descuento</th><th>Total</th></tr></thead><tbody>
          {sales.length === 0 && <tr><td colSpan={8}>No hay ventas para los filtros seleccionados.</td></tr>}
          {sales.map((sale) => <tr key={sale.id}><td>{sale.createdAt.toLocaleString("es-CL")}</td><td><Link href={`/admin/pos/ventas/${sale.id}`}>{sale.saleNumber}</Link></td><td>{sale.shift?.register.name ?? "—"}</td><td>{sale.shift?.user.name ?? sale.cashierUser?.name ?? sale.cashier}</td><td>{paymentLabels[sale.paymentMethod]}</td><td>{formatClp(sale.subtotal)}</td><td>{formatClp(sale.discount)}</td><td><strong>{formatClp(sale.total)}</strong></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
