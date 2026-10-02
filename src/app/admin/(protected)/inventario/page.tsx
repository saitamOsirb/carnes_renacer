import {
  applyStockMovement,
  createWarehouse,
  transferStock,
  updateMinimumStock,
  updateWarehouse,
} from "@/app/admin/inventory-actions";
import { prisma } from "@/lib/prisma";
import { formatQuantity, roundQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const movementLabels: Record<string, string> = {
  OPENING: "Apertura",
  RECEIVE: "Entrada",
  ISSUE: "Salida",
  ADJUSTMENT: "Ajuste",
  TRANSFER_OUT: "Transferencia salida",
  TRANSFER_IN: "Transferencia entrada",
  RESERVATION: "Reserva",
  RESERVATION_RELEASE: "Liberación reserva",
  SALE: "Venta",
};

function quantityInputStep(unit?: string): string {
  return unit === "UNIT" ? "1" : "0.001";
}

export default async function AdminInventoryPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [warehouses, products, stocks, movements, query] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }] }),
    prisma.product.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.inventoryStock.findMany({ include: { warehouse: true, product: true } }),
    prisma.inventoryMovement.findMany({ include: { warehouse: true, product: true }, orderBy: { createdAt: "desc" }, take: 80 }),
    searchParams,
  ]);

  stocks.sort((left, right) => left.product.name.localeCompare(right.product.name, "es") || left.warehouse.name.localeCompare(right.warehouse.name, "es"));

  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active);
  const lowStock = stocks.filter((stock) => {
    const minStock = toQuantityNumber(stock.minStock);
    const available = roundQuantity(toQuantityNumber(stock.onHand) - toQuantityNumber(stock.reserved));
    return stock.warehouse.active && minStock > 0 && available <= minStock;
  }).length;
  const reservedProducts = products.filter((product) => toQuantityNumber(product.reserved) > 0).length;
  const stockedProducts = products.filter((product) => toQuantityNumber(product.stock) > 0 || toQuantityNumber(product.reserved) > 0).length;

  return (
    <div className="admin-content admin-inventory-page">
      <div className="admin-title-row"><div><span className="admin-kicker">Operación</span><h1>Inventario y bodegas</h1><p>Stock físico, reservado y disponible con precisión de gramos para productos por kilo.</p></div></div>
      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{activeWarehouses.length}</strong><span>bodegas activas</span></div>
        <div className="admin-stat"><strong>{stockedProducts}</strong><span>productos con stock</span></div>
        <div className="admin-stat"><strong>{reservedProducts}</strong><span>productos con reservas</span></div>
        <div className={`admin-stat${lowStock > 0 ? " admin-stat-warning" : ""}`}><strong>{lowStock}</strong><span>alertas de mínimo</span></div>
      </section>

      <section className="admin-card admin-inventory-section">
        <div className="admin-card-heading"><div><h2>Mantenedor de bodegas</h2><p>Crea varias bodegas, define la principal y conserva su trazabilidad.</p></div></div>
        <form action={createWarehouse} className="admin-form admin-grid admin-grid-3 admin-form-inline-card">
          <label>Código<input name="code" required maxLength={40} placeholder="CENTRAL-2" /></label>
          <label>Nombre<input name="name" required maxLength={191} placeholder="Bodega Norte" /></label>
          <label>Dirección<input name="address" maxLength={255} placeholder="Dirección opcional" /></label>
          <button className="admin-button admin-button-primary" type="submit">Crear bodega</button>
        </form>
        <div className="admin-warehouse-grid">{warehouses.map((warehouse) => (
          <form action={updateWarehouse} className={`admin-warehouse-card${warehouse.active ? "" : " is-inactive"}`} key={warehouse.id}>
            <input type="hidden" name="id" value={warehouse.id} />
            <div className="admin-warehouse-title"><strong>{warehouse.name}</strong><span>{warehouse.isDefault ? "Principal" : warehouse.active ? "Activa" : "Inactiva"}</span></div>
            <label>Código<input name="code" required defaultValue={warehouse.code} maxLength={40} /></label>
            <label>Nombre<input name="name" required defaultValue={warehouse.name} maxLength={191} /></label>
            <label>Dirección<input name="address" defaultValue={warehouse.address ?? ""} maxLength={255} /></label>
            <div className="admin-checks"><label><input type="checkbox" name="active" defaultChecked={warehouse.active} /> Activa</label><label><input type="checkbox" name="isDefault" defaultChecked={warehouse.isDefault} /> Bodega principal</label></div>
            <button className="admin-button admin-button-secondary" type="submit">Guardar bodega</button>
          </form>
        ))}</div>
      </section>

      <section className="admin-operation-grid">
        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Movimiento de stock</h2><p>Registra recepción, salida o conteo físico. Para kg puedes ingresar, por ejemplo, 0,742.</p></div></div>
          <form action={applyStockMovement} className="admin-form">
            <label>Bodega<select name="warehouseId" required defaultValue=""><option value="" disabled>Selecciona bodega</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>Producto<select name="productId" required defaultValue=""><option value="" disabled>Selecciona producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · disp. {formatQuantity(product.stock, product.unit)}</option>)}</select></label>
            <label>Operación<select name="mode" required defaultValue="RECEIVE"><option value="RECEIVE">Entrada / recepción</option><option value="ISSUE">Salida manual</option><option value="SET">Ajustar a conteo físico</option></select></label>
            <label>Cantidad / peso<input name="quantity" type="number" required min="0" step="0.001" /></label>
            <label>Observación<textarea name="note" maxLength={500} rows={3} placeholder="Factura, merma, conteo, proveedor…" /></label>
            <button className="admin-button admin-button-primary" type="submit">Registrar movimiento</button>
          </form>
        </div>

        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Transferencia entre bodegas</h2><p>Mueve stock disponible sin cambiar el total global.</p></div></div>
          <form action={transferStock} className="admin-form">
            <label>Origen<select name="sourceWarehouseId" required defaultValue=""><option value="" disabled>Selecciona origen</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>Destino<select name="targetWarehouseId" required defaultValue=""><option value="" disabled>Selecciona destino</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>Producto<select name="productId" required defaultValue=""><option value="" disabled>Selecciona producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
            <label>Cantidad / peso<input name="quantity" type="number" required min="0.001" step="0.001" /></label>
            <label>Observación<textarea name="note" maxLength={500} rows={3} placeholder="Motivo o documento de traslado" /></label>
            <button className="admin-button admin-button-primary" type="submit">Transferir stock</button>
          </form>
        </div>
      </section>

      <section className="admin-card admin-inventory-section">
        <div className="admin-card-heading"><div><h2>Stock por bodega</h2><p>El disponible corresponde a físico menos reservado. Kg se muestran con hasta tres decimales.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Producto</th><th>Bodega</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th>Mínimo</th><th>Estado</th></tr></thead>
          <tbody>
            {stocks.length === 0 && <tr><td colSpan={7}>Aún no hay posiciones de inventario.</td></tr>}
            {stocks.map((stock) => {
              const onHand = toQuantityNumber(stock.onHand);
              const reserved = toQuantityNumber(stock.reserved);
              const minStock = toQuantityNumber(stock.minStock);
              const available = roundQuantity(onHand - reserved);
              const low = minStock > 0 && available <= minStock;
              return <tr key={stock.id}>
                <td><strong>{stock.product.name}</strong><small>{stock.product.active ? "Activo" : "Producto inactivo"}</small></td>
                <td>{stock.warehouse.name}<small>{stock.warehouse.code}</small></td>
                <td>{formatQuantity(onHand, stock.product.unit)}</td>
                <td>{formatQuantity(reserved, stock.product.unit)}</td>
                <td><strong>{formatQuantity(available, stock.product.unit)}</strong></td>
                <td><form action={updateMinimumStock} className="admin-min-stock-form">
                  <input type="hidden" name="warehouseId" value={stock.warehouseId} /><input type="hidden" name="productId" value={stock.productId} />
                  <input name="minStock" type="number" min="0" step={quantityInputStep(stock.product.unit)} defaultValue={minStock} aria-label={`Stock mínimo de ${stock.product.name} en ${stock.warehouse.name}`} />
                  <button className="admin-button admin-button-secondary" type="submit">Guardar</button>
                </form></td>
                <td><span className={`admin-stock-badge${low ? " is-low" : ""}`}>{low ? "Stock bajo" : stock.warehouse.active ? "OK" : "Bodega inactiva"}</span></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </section>

      <section className="admin-card admin-inventory-section">
        <div className="admin-card-heading"><div><h2>Kardex de movimientos</h2><p>Últimos 80 movimientos, incluyendo reservas, ventas y transferencias.</p></div></div>
        <div className="admin-table-wrap"><table className="admin-table admin-movement-table">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Bodega</th><th>Movimiento</th><th>Cantidad</th><th>Saldo físico</th><th>Reservado</th><th>Referencia</th></tr></thead>
          <tbody>
            {movements.length === 0 && <tr><td colSpan={8}>No hay movimientos registrados.</td></tr>}
            {movements.map((movement) => {
              const quantity = toQuantityNumber(movement.quantity);
              return <tr key={movement.id}>
                <td>{movement.createdAt.toLocaleString("es-CL")}</td>
                <td><strong>{movement.product.name}</strong>{movement.note && <small>{movement.note}</small>}</td>
                <td>{movement.warehouse.name}</td><td>{movementLabels[movement.type] ?? movement.type}</td>
                <td className={quantity < 0 ? "admin-qty-negative" : quantity > 0 ? "admin-qty-positive" : ""}>{quantity > 0 ? "+" : ""}{formatQuantity(quantity, movement.product.unit)}</td>
                <td>{formatQuantity(movement.onHandAfter, movement.product.unit)}</td><td>{formatQuantity(movement.reservedAfter, movement.product.unit)}</td><td><small>{movement.reference ?? "—"}</small></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
