import Link from "next/link";
import { PosCashMovementType, PosPaymentMethod, PosShiftStatus, Prisma } from "@prisma/client";
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

type SalesMetric = {
  count: number;
  total: number;
  discount: number;
};

type NamedMetric = SalesMetric & {
  label: string;
  detail?: string;
};

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function safeDate(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekKey(date: Date): string {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (current.getDay() + 6) % 7;
  current.setDate(current.getDate() - mondayOffset);
  return localDayKey(current);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString("es-CL", { weekday: "short", day: "2-digit", month: "short" });
}

function weekLabel(key: string): string {
  const start = new Date(`${key}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function addMetric(map: Map<string, SalesMetric>, key: string, total: number, discount: number): void {
  const current = map.get(key) ?? { count: 0, total: 0, discount: 0 };
  map.set(key, {
    count: current.count + 1,
    total: current.total + total,
    discount: current.discount + discount,
  });
}

function addNamedMetric(
  map: Map<string, NamedMetric>,
  key: string,
  label: string,
  detail: string | undefined,
  total: number,
  discount: number,
): void {
  const current = map.get(key) ?? { label, detail, count: 0, total: 0, discount: 0 };
  map.set(key, {
    ...current,
    count: current.count + 1,
    total: current.total + total,
    discount: current.discount + discount,
  });
}

function average(metric: SalesMetric): number {
  return metric.count > 0 ? Math.round(metric.total / metric.count) : 0;
}

function SalesBarChart({ rows, emptyText }: { rows: Array<{ key: string; label: string; detail?: string; metric: SalesMetric }>; emptyText: string }) {
  if (rows.length === 0) return <div className="pos-report-chart-empty">{emptyText}</div>;
  const max = Math.max(...rows.map((row) => row.metric.total), 1);

  return (
    <div className="pos-report-chart" role="img" aria-label="Gráfico de ventas">
      {rows.map((row) => {
        const width = row.metric.total > 0 ? Math.max(3, Math.round((row.metric.total / max) * 100)) : 0;
        return (
          <div className="pos-report-chart-row" key={row.key}>
            <div className="pos-report-chart-label">
              <strong>{row.label}</strong>
              <small>{row.detail ?? `${row.metric.count} venta${row.metric.count === 1 ? "" : "s"}`}</small>
            </div>
            <div className="pos-report-chart-track" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </div>
            <div className="pos-report-chart-value">
              <strong>{formatClp(row.metric.total)}</strong>
              <small>{row.metric.count} ventas</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeriodTable({ rows, periodLabel }: { rows: Array<{ key: string; label: string; metric: SalesMetric }>; periodLabel: string }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table pos-report-summary-table">
        <thead><tr><th>{periodLabel}</th><th>Ventas</th><th>Venta total</th><th>Descuentos</th><th>Ticket promedio</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5}>No hay ventas para el período seleccionado.</td></tr>}
          {rows.map((row) => (
            <tr key={row.key}>
              <td><strong>{row.label}</strong></td>
              <td>{row.metric.count}</td>
              <td><strong>{formatClp(row.metric.total)}</strong></td>
              <td>{formatClp(row.metric.discount)}</td>
              <td>{formatClp(average(row.metric))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PosReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; registerId?: string; userId?: string }> }) {
  const query = await searchParams;
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
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
    }),
  ]);

  const salesTotal = sales.reduce((sum, sale) => sum + sale.total, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + sale.discount, 0);
  const averageTicket = sales.length > 0 ? Math.round(salesTotal / sales.length) : 0;
  const paymentTotals = new Map<PosPaymentMethod, SalesMetric>();
  const registerTotals = new Map<string, NamedMetric>();
  const userTotals = new Map<string, NamedMetric>();
  const dailyTotals = new Map<string, SalesMetric>();
  const weeklyTotals = new Map<string, SalesMetric>();
  const monthlyTotals = new Map<string, SalesMetric>();

  for (const sale of sales) {
    const payment = paymentTotals.get(sale.paymentMethod) ?? { count: 0, total: 0, discount: 0 };
    paymentTotals.set(sale.paymentMethod, {
      count: payment.count + 1,
      total: payment.total + sale.total,
      discount: payment.discount + sale.discount,
    });

    const register = sale.shift?.register;
    addNamedMetric(
      registerTotals,
      register?.id ?? "legacy",
      register?.name ?? "Ventas POS anteriores",
      register ? register.code : "Sin caja histórica",
      sale.total,
      sale.discount,
    );

    const user = sale.shift?.user ?? sale.cashierUser;
    addNamedMetric(
      userTotals,
      user?.id ?? `legacy:${sale.cashier}`,
      user?.name ?? sale.cashier,
      user ? user.username : "Registro histórico",
      sale.total,
      sale.discount,
    );

    addMetric(dailyTotals, localDayKey(sale.createdAt), sale.total, sale.discount);
    addMetric(weeklyTotals, weekKey(sale.createdAt), sale.total, sale.discount);
    addMetric(monthlyTotals, monthKey(sale.createdAt), sale.total, sale.discount);
  }

  const dailyRows = [...dailyTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, metric]) => ({ key, label: dayLabel(key), metric }));
  const weeklyRows = [...weeklyTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, metric]) => ({ key, label: weekLabel(key), metric }));
  const monthlyRows = [...monthlyTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, metric]) => ({ key, label: monthLabel(key), metric }));
  const registerRows = [...registerTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([key, metric]) => ({ key, label: metric.label, detail: metric.detail, metric }));
  const userRows = [...userTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([key, metric]) => ({ key, label: metric.label, detail: metric.detail, metric }));
  const paymentRows = Object.values(PosPaymentMethod).map((method) => ({
    key: method,
    label: paymentLabels[method],
    metric: paymentTotals.get(method) ?? { count: 0, total: 0, discount: 0 },
  }));

  const closedShifts = shifts.filter((shift) => shift.status === PosShiftStatus.CLOSED);
  const totalDifference = closedShifts.reduce((sum, shift) => sum + (shift.difference ?? 0), 0);

  const todayHref = `/admin/pos/reportes?from=${dateValue(today)}&to=${dateValue(today)}`;
  const sevenDaysHref = `/admin/pos/reportes?from=${dateValue(sevenDaysAgo)}&to=${dateValue(today)}`;
  const monthHref = `/admin/pos/reportes?from=${dateValue(monthStart)}&to=${dateValue(today)}`;

  return (
    <div className="admin-content pos-admin-page pos-sales-report-page">
      <div className="admin-title-row">
        <div><span className="admin-kicker">POS · Analítica</span><h1>Reportes de ventas</h1><p>Ventas diarias, semanales y mensuales, con desglose por vendedor, caja y medio de pago.</p></div>
        <div className="pos-page-actions no-print"><Link className="admin-button admin-button-secondary" href="/admin/pos">POS</Link><Link className="admin-button admin-button-secondary" href="/admin/pos/cajas">Cajas</Link><PrintButton /></div>
      </div>

      <div className="pos-report-presets no-print">
        <Link href={todayHref}>Hoy</Link>
        <Link href={sevenDaysHref}>Últimos 7 días</Link>
        <Link href={monthHref}>Mes actual</Link>
      </div>

      <form className="admin-card pos-report-filters no-print" method="get">
        <label>Desde<input type="date" name="from" defaultValue={from} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={to} /></label>
        <label>Caja<select name="registerId" defaultValue={query.registerId ?? ""}><option value="">Todas</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.code} · {register.name}</option>)}</select></label>
        <label>Vendedor / cajero<select name="userId" defaultValue={query.userId ?? ""}><option value="">Todos</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <button className="admin-button admin-button-primary" type="submit">Aplicar filtros</button>
      </form>

      <section className="admin-stats-grid pos-report-stats">
        <div className="admin-stat"><strong>{sales.length}</strong><span>ventas</span></div>
        <div className="admin-stat"><strong>{formatClp(salesTotal)}</strong><span>venta total</span></div>
        <div className="admin-stat"><strong>{formatClp(averageTicket)}</strong><span>ticket promedio</span></div>
        <div className="admin-stat"><strong>{formatClp(discountTotal)}</strong><span>descuentos</span></div>
        <div className="admin-stat"><strong>{shifts.length}</strong><span>turnos</span></div>
        <div className={`admin-stat${totalDifference !== 0 ? " admin-stat-warning" : ""}`}><strong>{formatClp(totalDifference)}</strong><span>diferencia cierres</span></div>
      </section>

      <section className="admin-card pos-management-section pos-report-section">
        <div className="admin-card-heading"><div><span className="admin-kicker">Día a día</span><h2>Ventas diarias</h2><p>Evolución de ventas para cada día dentro del período seleccionado.</p></div></div>
        <SalesBarChart rows={dailyRows.map((row) => ({ ...row, detail: `${row.metric.count} ventas · ticket ${formatClp(average(row.metric))}` }))} emptyText="No hay ventas diarias para mostrar." />
        <PeriodTable rows={dailyRows} periodLabel="Día" />
      </section>

      <section className="admin-report-grid-2 pos-management-section">
        <div className="admin-card pos-report-section">
          <div className="admin-card-heading"><div><span className="admin-kicker">Semana</span><h2>Ventas semanales</h2><p>Semanas de lunes a domingo.</p></div></div>
          <SalesBarChart rows={weeklyRows} emptyText="No hay semanas con ventas." />
          <PeriodTable rows={weeklyRows} periodLabel="Semana" />
        </div>
        <div className="admin-card pos-report-section">
          <div className="admin-card-heading"><div><span className="admin-kicker">Mes</span><h2>Ventas mensuales</h2><p>Consolidado mensual del rango seleccionado.</p></div></div>
          <SalesBarChart rows={monthlyRows} emptyText="No hay meses con ventas." />
          <PeriodTable rows={monthlyRows} periodLabel="Mes" />
        </div>
      </section>

      <section className="admin-report-grid-2 pos-management-section">
        <div className="admin-card pos-report-section">
          <div className="admin-card-heading"><div><span className="admin-kicker">Equipo</span><h2>Ventas por vendedor</h2><p>Comparativo de cajeros según las ventas registradas.</p></div></div>
          <SalesBarChart rows={userRows} emptyText="No hay ventas asociadas a vendedores." />
          <div className="admin-table-wrap"><table className="admin-table pos-report-summary-table"><thead><tr><th>Vendedor</th><th>Ventas</th><th>Total</th><th>Descuentos</th><th>Ticket promedio</th></tr></thead><tbody>{userRows.length === 0 && <tr><td colSpan={5}>Sin ventas.</td></tr>}{userRows.map((row) => <tr key={row.key}><td><strong>{row.label}</strong><small>{row.detail}</small></td><td>{row.metric.count}</td><td><strong>{formatClp(row.metric.total)}</strong></td><td>{formatClp(row.metric.discount)}</td><td>{formatClp(average(row.metric))}</td></tr>)}</tbody></table></div>
        </div>

        <div className="admin-card pos-report-section">
          <div className="admin-card-heading"><div><span className="admin-kicker">Operación</span><h2>Ventas por caja</h2><p>Comparativo de cajas registradoras.</p></div></div>
          <SalesBarChart rows={registerRows} emptyText="No hay ventas asociadas a cajas." />
          <div className="admin-table-wrap"><table className="admin-table pos-report-summary-table"><thead><tr><th>Caja</th><th>Ventas</th><th>Total</th><th>Descuentos</th><th>Ticket promedio</th></tr></thead><tbody>{registerRows.length === 0 && <tr><td colSpan={5}>Sin ventas.</td></tr>}{registerRows.map((row) => <tr key={row.key}><td><strong>{row.label}</strong><small>{row.detail}</small></td><td>{row.metric.count}</td><td><strong>{formatClp(row.metric.total)}</strong></td><td>{formatClp(row.metric.discount)}</td><td>{formatClp(average(row.metric))}</td></tr>)}</tbody></table></div>
        </div>
      </section>

      <section className="admin-card pos-management-section pos-report-section">
        <div className="admin-card-heading"><div><span className="admin-kicker">Cobros</span><h2>Ventas por medio de pago</h2><p>Distribución del ingreso por forma de pago.</p></div></div>
        <SalesBarChart rows={paymentRows} emptyText="No hay medios de pago con ventas." />
        <div className="admin-table-wrap"><table className="admin-table pos-report-summary-table"><thead><tr><th>Medio</th><th>Ventas</th><th>Total</th><th>Participación</th></tr></thead><tbody>{paymentRows.map((row) => <tr key={row.key}><td><strong>{row.label}</strong></td><td>{row.metric.count}</td><td><strong>{formatClp(row.metric.total)}</strong></td><td>{salesTotal > 0 ? `${((row.metric.total / salesTotal) * 100).toFixed(1)}%` : "0%"}</td></tr>)}</tbody></table></div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Turnos de caja</h2><p>Apertura, venta, movimientos de efectivo y diferencias de cierre.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Apertura / cierre</th><th>Caja</th><th>Cajero</th><th>Ventas</th><th>Apertura</th><th>Efectivo vendido</th><th>Ingresos</th><th>Retiros</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th><th className="no-print"></th></tr></thead><tbody>
          {shifts.length === 0 && <tr><td colSpan={12}>No hay turnos para los filtros seleccionados.</td></tr>}
          {shifts.map((shift) => {
            const cashSales = shift.sales.filter((sale) => sale.paymentMethod === PosPaymentMethod.CASH).reduce((sum, sale) => sum + sale.total, 0);
            const cashIn = shift.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_IN).reduce((sum, movement) => sum + movement.amount, 0);
            const cashOut = shift.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_OUT).reduce((sum, movement) => sum + movement.amount, 0);
            const expected = shift.expectedCash ?? shift.openingAmount + cashSales + cashIn - cashOut;
            const totalSales = shift.sales.reduce((sum, sale) => sum + sale.total, 0);
            return <tr key={shift.id}><td>{shift.openedAt.toLocaleString("es-CL")}<small>{shift.closedAt ? `Cierre: ${shift.closedAt.toLocaleString("es-CL")}` : "Turno abierto"}</small></td><td>{shift.register.code}<small>{shift.register.name}</small></td><td>{shift.user.name}</td><td>{formatClp(totalSales)}<small>{shift.sales.length} ventas</small></td><td>{formatClp(shift.openingAmount)}</td><td>{formatClp(cashSales)}</td><td>{formatClp(cashIn)}</td><td>{formatClp(cashOut)}</td><td><strong>{formatClp(expected)}</strong></td><td>{shift.declaredCash === null ? "—" : formatClp(shift.declaredCash)}</td><td className={(shift.difference ?? 0) < 0 ? "admin-qty-negative" : (shift.difference ?? 0) > 0 ? "admin-qty-positive" : ""}>{shift.difference === null ? "—" : formatClp(shift.difference)}</td><td className="no-print"><Link href={`/admin/pos/turnos/${shift.id}`}>Ver reporte</Link></td></tr>;
          })}
        </tbody></table></div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Detalle de ventas</h2><p>{sales.length} operaciones dentro del período seleccionado.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Fecha</th><th>N° venta</th><th>Caja</th><th>Vendedor</th><th>Pago</th><th>Subtotal</th><th>Descuento</th><th>Total</th></tr></thead><tbody>
          {sales.length === 0 && <tr><td colSpan={8}>No hay ventas para los filtros seleccionados.</td></tr>}
          {sales.map((sale) => <tr key={sale.id}><td>{sale.createdAt.toLocaleString("es-CL")}</td><td><Link href={`/admin/pos/ventas/${sale.id}`}>{sale.saleNumber}</Link></td><td>{sale.shift?.register.name ?? "—"}</td><td>{sale.shift?.user.name ?? sale.cashierUser?.name ?? sale.cashier}</td><td>{paymentLabels[sale.paymentMethod]}</td><td>{formatClp(sale.subtotal)}</td><td>{formatClp(sale.discount)}</td><td><strong>{formatClp(sale.total)}</strong></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
