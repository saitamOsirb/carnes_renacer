import Link from "next/link";
import { PosCashMovementType, PosPaymentMethod, PosShiftStatus } from "@prisma/client";
import { PosTerminal } from "@/components/admin/pos-terminal";
import { addPosCashMovement, closePosShift, openPosShift } from "@/app/admin/pos-management-actions";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { roundQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const paymentLabels: Record<PosPaymentMethod, string> = {
  CASH: "Efectivo",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

export default async function AdminPosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; sale?: string; shift?: string }> }) {
  const query = await searchParams;
  const [registers, users, openShifts, recentSales, customers] = await Promise.all([
    prisma.cashRegister.findMany({ where: { active: true, warehouse: { active: true } }, include: { warehouse: true }, orderBy: { name: "asc" } }),
    prisma.posUser.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.posShift.findMany({
      where: { status: PosShiftStatus.OPEN },
      include: { register: { include: { warehouse: true } }, user: true, _count: { select: { sales: true } } },
      orderBy: { openedAt: "asc" },
    }),
    prisma.posSale.findMany({
      include: { warehouse: true, shift: { include: { register: true, user: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.customer.findMany({
      where: { active: true, anonymizedAt: null, privacyAcknowledgedAt: { not: null } },
      select: { id: true, name: true, rut: true, email: true, phone: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);

  const selectedShift = query.shift
    ? await prisma.posShift.findFirst({
        where: { id: query.shift, status: PosShiftStatus.OPEN },
        include: {
          user: true,
          register: {
            include: {
              warehouse: {
                include: {
                  stocks: { where: { product: { active: true } }, include: { product: true } },
                },
              },
            },
          },
          sales: { select: { total: true, paymentMethod: true } },
          cashMovements: { orderBy: { createdAt: "desc" } },
        },
      })
    : null;

  const cashSales = selectedShift?.sales.filter((sale) => sale.paymentMethod === PosPaymentMethod.CASH).reduce((sum, sale) => sum + sale.total, 0) ?? 0;
  const cashIn = selectedShift?.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_IN).reduce((sum, movement) => sum + movement.amount, 0) ?? 0;
  const cashOut = selectedShift?.cashMovements.filter((movement) => movement.type === PosCashMovementType.CASH_OUT).reduce((sum, movement) => sum + movement.amount, 0) ?? 0;
  const expectedCash = selectedShift ? selectedShift.openingAmount + cashSales + cashIn - cashOut : 0;

  const products = selectedShift?.register.warehouse.stocks
    .map((stock) => ({
      id: stock.product.id,
      name: stock.product.name,
      category: stock.product.category,
      imageUrl: stock.product.imageUrl,
      price: stock.product.price,
      unit: stock.product.unit,
      available: roundQuantity(Math.max(0, toQuantityNumber(stock.onHand) - toQuantityNumber(stock.reserved))),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "es")) ?? [];

  const busyRegisterIds = new Set(openShifts.map((shift) => shift.registerId));
  const busyUserIds = new Set(openShifts.map((shift) => shift.userId));

  return (
    <div className="admin-content pos-page pos-admin-page">
      <div className="admin-title-row">
        <div><span className="admin-kicker">Venta presencial</span><h1>Punto de venta</h1><p>Múltiples cajas y cajeros con apertura, cierre, arqueo, clientes e inventario por bodega.</p></div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/pos/cajas">Cajas</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/pos/configuracion">Usuarios POS</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/clientes">Clientes</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/pos/reportes">Reportes</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}{query.sale && <> · <Link href={`/admin/pos/ventas/${query.sale}`}>Ver comprobante</Link></>}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}
      {query.shift && !selectedShift && <div className="admin-alert admin-alert-error">El turno solicitado ya no está abierto.</div>}

      <section className="admin-card pos-shift-section">
        <div className="admin-card-heading"><div><h2>Abrir caja</h2><p>Un cajero y una caja solo pueden mantener un turno abierto simultáneamente.</p></div></div>
        {users.length === 0 || registers.length === 0 ? (
          <div className="admin-inline-notice">Necesitas al menos un usuario POS y una caja activa. <Link href={registers.length === 0 ? "/admin/pos/cajas" : "/admin/pos/configuracion"}>Completar configuración</Link>.</div>
        ) : (
          <form action={openPosShift} className="pos-open-shift-form">
            <label>Caja<select name="registerId" required defaultValue=""><option value="" disabled>Selecciona caja</option>{registers.map((register) => <option key={register.id} value={register.id} disabled={busyRegisterIds.has(register.id)}>{register.code} · {register.name} · {register.warehouse.name}{busyRegisterIds.has(register.id) ? " · EN USO" : ""}</option>)}</select></label>
            <label>Cajero<select name="userId" required defaultValue=""><option value="" disabled>Selecciona cajero</option>{users.map((user) => <option key={user.id} value={user.id} disabled={busyUserIds.has(user.id)}>{user.name} · {user.username}{busyUserIds.has(user.id) ? " · EN TURNO" : ""}</option>)}</select></label>
            <label>PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" required minLength={4} maxLength={12} autoComplete="off" /></label>
            <label>Fondo inicial<input name="openingAmount" type="number" min="0" step="1" defaultValue="0" required /></label>
            <label className="pos-open-notes">Observación<input name="openingNotes" maxLength={500} placeholder="Turno mañana, fondo entregado…" /></label>
            <button className="admin-button admin-button-primary" type="submit">Abrir caja</button>
          </form>
        )}
      </section>

      <section className="pos-active-shifts">
        <div className="admin-card-heading"><div><h2>Cajas abiertas</h2><p>{openShifts.length} turno(s) activo(s).</p></div></div>
        {openShifts.length === 0 && <div className="admin-card pos-empty">No hay cajas abiertas.</div>}
        <div className="pos-shift-cards">{openShifts.map((shift) => (
          <Link href={`/admin/pos?shift=${shift.id}`} key={shift.id} className={`pos-shift-card${selectedShift?.id === shift.id ? " is-selected" : ""}`}>
            <span>{shift.register.code}</span><strong>{shift.register.name}</strong><small>{shift.user.name} · {shift.register.warehouse.name}</small><small>Abierta {shift.openedAt.toLocaleString("es-CL")} · {shift._count.sales} ventas</small>
          </Link>
        ))}</div>
      </section>

      {selectedShift && <>
        <section className="admin-stats-grid pos-shift-stats">
          <div className="admin-stat"><strong>{formatClp(selectedShift.openingAmount)}</strong><span>fondo inicial</span></div>
          <div className="admin-stat"><strong>{formatClp(cashSales)}</strong><span>ventas efectivo</span></div>
          <div className="admin-stat"><strong>{formatClp(cashIn)}</strong><span>ingresos caja</span></div>
          <div className="admin-stat"><strong>{formatClp(cashOut)}</strong><span>retiros caja</span></div>
          <div className="admin-stat"><strong>{formatClp(expectedCash)}</strong><span>efectivo esperado</span></div>
        </section>

        <PosTerminal shiftId={selectedShift.id} registerName={`${selectedShift.register.code} · ${selectedShift.register.name}`} cashierName={selectedShift.user.name} warehouseName={selectedShift.register.warehouse.name} products={products} customers={customers} />

        <section className="admin-operation-grid pos-cash-controls">
          <div className="admin-card">
            <div className="admin-card-heading"><div><h2>Movimiento de efectivo</h2><p>Registra ingresos o retiros no asociados a una venta.</p></div></div>
            <form action={addPosCashMovement} className="admin-form">
              <input type="hidden" name="shiftId" value={selectedShift.id} />
              <label>Tipo<select name="type" defaultValue="CASH_OUT"><option value="CASH_IN">Ingreso de efectivo</option><option value="CASH_OUT">Retiro de efectivo</option></select></label>
              <label>Monto<input name="amount" type="number" min="1" step="1" required /></label>
              <label>Motivo<textarea name="reason" rows={3} minLength={3} maxLength={500} required placeholder="Pago menor, retiro a caja fuerte, sencillo…" /></label>
              <button className="admin-button admin-button-secondary" type="submit">Registrar movimiento</button>
            </form>
          </div>
          <div className="admin-card pos-close-card">
            <div className="admin-card-heading"><div><h2>Cerrar y cuadrar caja</h2><p>Cuenta el efectivo físico. El sistema comparará contra {formatClp(expectedCash)} esperado.</p></div></div>
            <form action={closePosShift} className="admin-form">
              <input type="hidden" name="shiftId" value={selectedShift.id} />
              <label>Efectivo contado<input name="declaredCash" type="number" min="0" step="1" required /></label>
              <label>PIN de {selectedShift.user.name}<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" required minLength={4} maxLength={12} autoComplete="off" /></label>
              <label>Observación de cierre<textarea name="closingNotes" rows={3} maxLength={500} placeholder="Diferencia justificada, entrega de turno…" /></label>
              <button className="admin-button admin-button-danger" type="submit">Cerrar caja</button>
            </form>
          </div>
        </section>

        {selectedShift.cashMovements.length > 0 && <section className="admin-card pos-management-section">
          <div className="admin-card-heading"><div><h2>Movimientos del turno</h2><p>Ingresos y retiros registrados en esta caja.</p></div></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Hora</th><th>Tipo</th><th>Monto</th><th>Motivo</th></tr></thead><tbody>{selectedShift.cashMovements.map((movement) => <tr key={movement.id}><td>{movement.createdAt.toLocaleString("es-CL")}</td><td>{movement.type === PosCashMovementType.CASH_IN ? "Ingreso" : "Retiro"}</td><td className={movement.type === PosCashMovementType.CASH_IN ? "admin-qty-positive" : "admin-qty-negative"}>{movement.type === PosCashMovementType.CASH_IN ? "+" : "−"}{formatClp(movement.amount)}</td><td>{movement.reason}</td></tr>)}</tbody></table></div>
        </section>}
      </>}

      <section className="admin-card pos-history">
        <div className="admin-card-heading"><div><h2>Ventas recientes</h2><p>Últimas 20 operaciones registradas en todas las cajas.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Fecha</th><th>N° venta</th><th>Caja</th><th>Cajero</th><th>Pago</th><th>Productos</th><th>Total</th><th></th></tr></thead>
          <tbody>{recentSales.length === 0 && <tr><td colSpan={8}>Aún no hay ventas POS.</td></tr>}{recentSales.map((sale) => (
            <tr key={sale.id}><td>{sale.createdAt.toLocaleString("es-CL")}</td><td><strong>{sale.saleNumber}</strong>{sale.customerName && <small>{sale.customerName}</small>}</td><td>{sale.shift?.register.name ?? sale.warehouse.name}</td><td>{sale.shift?.user.name ?? sale.cashier}</td><td>{paymentLabels[sale.paymentMethod]}</td><td>{sale._count.items}</td><td><strong>{formatClp(sale.total)}</strong></td><td><Link className="pos-receipt-link" href={`/admin/pos/ventas/${sale.id}`}>Comprobante</Link></td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  );
}
