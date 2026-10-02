import Link from "next/link";
import { Prisma } from "@prisma/client";
import { assignLotPlacementAction, removeLotPlacementAction } from "@/app/admin/lot-actions";
import { prisma } from "@/lib/prisma";
import { formatQuantity, roundQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

function expiryInfo(expirationDate: Date | null, now: Date): { label: string; className: string; days: number | null } {
  if (!expirationDate) return { label: "Sin vencimiento informado", className: "", days: null };
  const days = Math.ceil((expirationDate.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { label: `Vencido hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`, className: "admin-qty-negative", days };
  if (days === 0) return { label: "Vence hoy", className: "admin-qty-negative", days };
  if (days <= 7) return { label: `Vence en ${days} día${days === 1 ? "" : "s"}`, className: "admin-qty-negative", days };
  if (days <= 30) return { label: `Vence en ${days} días`, className: "", days };
  return { label: `Vence en ${days} días`, className: "admin-qty-positive", days };
}

export default async function LotsPage({ searchParams }: { searchParams: Promise<{ q?: string; warehouseId?: string; alert?: string; ok?: string; error?: string }> }) {
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 100) ?? "";
  const warehouseId = query.warehouseId?.slice(0, 30) ?? "";
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 86_400_000);

  const where: Prisma.InventoryLotStockWhereInput = {
    onHand: { gt: 0 },
    ...(warehouseId ? { warehouseId } : {}),
    ...(query.alert === "expiring" ? { lot: { expirationDate: { lte: thirtyDays } } } : {}),
    ...(q ? {
      OR: [
        { lot: { internalCode: { contains: q } } },
        { lot: { supplierLotNumber: { contains: q } } },
        { lot: { product: { name: { contains: q } } } },
        { lot: { supplier: { name: { contains: q } } } },
      ],
    } : {}),
  };

  const [warehouses, stocks] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, include: { layout: { include: { objects: { orderBy: { label: "asc" } } } } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.inventoryLotStock.findMany({
      where,
      include: {
        warehouse: true,
        lot: {
          include: {
            product: { select: { id: true, name: true, unit: true, imageUrl: true } },
            supplier: { select: { name: true, rut: true } },
            purchaseReceiptItem: { include: { purchaseReceipt: { select: { receiptNumber: true, receivedAt: true } } } },
            placements: { include: { object: { select: { label: true } } }, orderBy: { createdAt: "asc" } },
            movements: { orderBy: { createdAt: "desc" }, take: 5 },
          },
        },
      },
      take: 500,
    }),
  ]);

  stocks.sort((a, b) => {
    const aExpiry = a.lot.expirationDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bExpiry = b.lot.expirationDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;
    return a.lot.internalCode.localeCompare(b.lot.internalCode);
  });

  let expired = 0;
  let sevenDays = 0;
  let thirty = 0;
  let noExpiry = 0;
  for (const stock of stocks) {
    const info = expiryInfo(stock.lot.expirationDate, now);
    if (info.days === null) noExpiry += 1;
    else if (info.days < 0) expired += 1;
    else if (info.days <= 7) sevenDays += 1;
    else if (info.days <= 30) thirty += 1;
  }

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div><span className="admin-kicker">Trazabilidad</span><h1>Lotes y vencimientos</h1><p>Saldo por lote y bodega, FEFO, proveedor, origen de recepción y ubicación física WMS.</p></div>
        <div className="pos-page-actions"><Link className="admin-button admin-button-secondary" href="/admin/compras">Compras</Link><Link className="admin-button admin-button-secondary" href="/admin/inventario/mapa">Mapa WMS</Link></div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{stocks.length}</strong><span>lotes con saldo</span></div>
        <div className="admin-stat"><strong>{expired}</strong><span>vencidos</span></div>
        <div className="admin-stat"><strong>{sevenDays}</strong><span>vencen ≤ 7 días</span></div>
        <div className="admin-stat"><strong>{thirty}</strong><span>vencen 8–30 días</span></div>
        <div className="admin-stat"><strong>{noExpiry}</strong><span>sin fecha</span></div>
      </section>

      <section className="admin-card admin-create-card">
        <form method="get" className="admin-form admin-grid admin-grid-3">
          <label>Buscar<input name="q" defaultValue={q} placeholder="Producto, lote, proveedor" /></label>
          <label>Bodega<select name="warehouseId" defaultValue={warehouseId}><option value="">Todas</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label>Alerta<select name="alert" defaultValue={query.alert ?? ""}><option value="">Todos</option><option value="expiring">Vencidos o ≤ 30 días</option></select></label>
          <button className="admin-button admin-button-secondary" type="submit">Filtrar</button>
          {(q || warehouseId || query.alert) && <Link className="admin-button admin-button-secondary" href="/admin/lotes">Limpiar</Link>}
        </form>
      </section>

      <div className="admin-inline-notice"><strong>FEFO activo:</strong> las ventas y salidas consumen primero los lotes con vencimiento más próximo. Los lotes sin fecha quedan al final. Una salida también reduce la ubicación detallada del lote.</div>

      <section className="admin-products-list">
        {stocks.length === 0 && <div className="admin-card pos-empty">No hay lotes con saldo para los filtros seleccionados.</div>}
        {stocks.map((stock, index) => {
          const lot = stock.lot;
          const info = expiryInfo(lot.expirationDate, now);
          const placements = lot.placements.filter((placement) => placement.warehouseId === stock.warehouseId);
          const located = roundQuantity(placements.reduce((sum, placement) => sum + toQuantityNumber(placement.quantity), 0));
          const unlocated = roundQuantity(Math.max(0, toQuantityNumber(stock.onHand) - located));
          const warehouse = warehouses.find((item) => item.id === stock.warehouseId);
          const objects = warehouse?.layout?.objects ?? [];
          return (
            <article className="admin-product-card" key={stock.id}>
              <div className="admin-product-preview">
                <div>
                  <strong>#{index + 1} FEFO · {lot.product.name}</strong>
                  <span>{lot.supplierLotNumber ? `Lote proveedor ${lot.supplierLotNumber}` : lot.internalCode}</span>
                  <small>{stock.warehouse.name} · {lot.supplier?.name ?? "Origen sin proveedor"}</small>
                </div>
                <div><strong>{formatQuantity(stock.onHand, lot.product.unit)}</strong><small>saldo lote</small></div>
              </div>

              <div className="admin-grid admin-grid-3">
                <div><small>Código interno</small><strong>{lot.internalCode}</strong></div>
                <div><small>Elaboración</small><strong>{lot.manufacturedAt ? lot.manufacturedAt.toLocaleDateString("es-CL") : "Sin fecha"}</strong></div>
                <div><small>Vencimiento</small><strong className={info.className}>{lot.expirationDate ? lot.expirationDate.toLocaleDateString("es-CL") : "Sin fecha"}</strong><p className={info.className}>{info.label}</p></div>
                <div><small>Recepción origen</small><strong>{lot.purchaseReceiptItem?.purchaseReceipt.receiptNumber ?? "Stock histórico/manual"}</strong></div>
                <div><small>Ubicado por lote</small><strong>{formatQuantity(located, lot.product.unit)}</strong></div>
                <div><small>Sin ubicación por lote</small><strong>{formatQuantity(unlocated, lot.product.unit)}</strong></div>
              </div>

              {placements.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Ubicación WMS</th><th>Código</th><th>Cantidad</th><th></th></tr></thead><tbody>{placements.map((placement) => <tr key={placement.id}><td>{placement.object.label}</td><td>{placement.locationCode || "—"}</td><td>{formatQuantity(placement.quantity, lot.product.unit)}</td><td><form action={removeLotPlacementAction}><input type="hidden" name="placementId" value={placement.id} /><input type="hidden" name="warehouseId" value={stock.warehouseId} /><button className="admin-button admin-button-secondary" type="submit">Desubicar</button></form></td></tr>)}</tbody></table></div>}

              {unlocated > 0 && objects.length > 0 && <form action={assignLotPlacementAction} className="admin-form admin-grid admin-grid-3">
                <input type="hidden" name="warehouseId" value={stock.warehouseId} />
                <input type="hidden" name="lotId" value={lot.id} />
                <label>Objeto WMS<select name="objectId" required defaultValue=""><option value="" disabled>Seleccionar…</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.label} · {object.type}</option>)}</select></label>
                <label>Código ubicación<input name="locationCode" maxLength={80} placeholder="A-01-02" /></label>
                <label>Cantidad<input name="quantity" type="number" min={0.001} max={unlocated} step={lot.product.unit === "KG" ? 0.001 : 1} required /></label>
                <button className="admin-button admin-button-primary" type="submit">Ubicar lote</button>
              </form>}
              {unlocated > 0 && objects.length === 0 && <div className="admin-inline-notice">Esta bodega aún no tiene objetos en el mapa 3D. Crea racks/cámaras antes de ubicar el lote.</div>}

              <details><summary>Últimos movimientos de lote</summary><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Saldo</th><th>Referencia</th></tr></thead><tbody>{lot.movements.filter((movement) => movement.warehouseId === stock.warehouseId).map((movement) => <tr key={movement.id}><td>{movement.createdAt.toLocaleString("es-CL")}</td><td>{movement.type}</td><td>{formatQuantity(movement.quantity, lot.product.unit)}</td><td>{formatQuantity(movement.balanceAfter, lot.product.unit)}</td><td>{movement.reference ?? "—"}</td></tr>)}</tbody></table></div></details>
            </article>
          );
        })}
      </section>
    </div>
  );
}
