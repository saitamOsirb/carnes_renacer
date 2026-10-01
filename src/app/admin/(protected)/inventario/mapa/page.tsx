import Image from "next/image";
import Link from "next/link";
import {
  adjustWarehouseProductPlacementQuantity,
  assignWarehouseProduct,
  moveWarehouseLocationStock,
  removeWarehouseProductPlacement,
  saveWarehouseDimensions,
} from "@/app/admin/warehouse-map-actions";
import { Warehouse3DEditor, type WarehouseSceneObject } from "@/components/admin/warehouse-3d-editor";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function meters(cm: number): string {
  return (cm / 100).toFixed(cm % 100 === 0 ? 0 : 2);
}

function unitLabel(unit: string): string {
  return unit === "KG" ? "kg" : "un.";
}

const movementLabels: Record<string, string> = {
  ALLOCATE: "Asignación",
  INTERNAL_TRANSFER: "Movimiento interno",
  ADJUST: "Ajuste de ubicación",
  UNASSIGN: "Stock sin ubicar",
  SYSTEM_DECREMENT: "Salida automática",
};

function placeLabel(label: string | null, code: string | null): string {
  if (!label) return "—";
  return code ? `${label} · ${code}` : label;
}

export default async function WarehouseMapPage({ searchParams }: { searchParams: Promise<{ warehouseId?: string; ok?: string; error?: string }> }) {
  const query = await searchParams;
  const warehouses = await prisma.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }] });
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === query.warehouseId)
    ?? warehouses.find((warehouse) => warehouse.isDefault)
    ?? warehouses[0]
    ?? null;

  if (!selectedWarehouse) {
    return <div className="admin-content"><div className="admin-card"><h1>Mapa 3D de bodega</h1><p>Primero crea una bodega desde Inventario.</p><Link className="admin-button admin-button-primary" href="/admin/inventario">Ir a inventario</Link></div></div>;
  }

  const [layout, stocks, locationMovements] = await Promise.all([
    prisma.warehouseLayout.findUnique({
      where: { warehouseId: selectedWarehouse.id },
      include: {
        objects: {
          include: { placements: { include: { product: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.inventoryStock.findMany({
      where: { warehouseId: selectedWarehouse.id },
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    }),
    prisma.warehouseLocationMovement.findMany({
      where: { warehouseId: selectedWarehouse.id },
      include: { product: { select: { name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const stockByProduct = new Map(stocks.map((stock) => [stock.productId, stock]));
  const placementRows = layout?.objects.flatMap((object) => object.placements.map((placement) => ({ ...placement, objectLabel: object.label }))) ?? [];
  const placementsByProduct = new Map<string, typeof placementRows>();
  for (const placement of placementRows) {
    const current = placementsByProduct.get(placement.productId) ?? [];
    current.push(placement);
    placementsByProduct.set(placement.productId, current);
  }

  const sceneObjects: WarehouseSceneObject[] = layout?.objects.map((object) => ({
    id: object.id,
    type: object.type,
    label: object.label,
    xCm: object.xCm,
    zCm: object.zCm,
    widthCm: object.widthCm,
    depthCm: object.depthCm,
    heightCm: object.heightCm,
    rotation: object.rotation,
    products: object.placements.map((placement) => {
      const stock = stockByProduct.get(placement.productId);
      return {
        id: placement.id,
        name: placement.product.name,
        imageUrl: placement.product.imageUrl,
        available: placement.quantity,
        onHand: stock?.onHand ?? 0,
        reserved: stock?.reserved ?? 0,
        unit: placement.product.unit,
        locationCode: placement.locationCode || null,
      };
    }),
  })) ?? [];

  const stocked = stocks.filter((stock) => stock.onHand > 0 || stock.reserved > 0);
  const locatedProducts = stocked.filter((stock) => (placementsByProduct.get(stock.productId)?.length ?? 0) > 0).length;
  const pendingProducts = stocked.filter((stock) => {
    const located = (placementsByProduct.get(stock.productId) ?? []).reduce((sum, placement) => sum + placement.quantity, 0);
    return stock.onHand > located;
  }).length;

  return (
    <div className="admin-content warehouse-map-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">WMS visual</span>
          <h1>Mapa 3D y ubicaciones</h1>
          <p>Dibuja la bodega, distribuye existencias por posición y conserva trazabilidad de los movimientos internos.</p>
        </div>
        <Link className="admin-button admin-button-secondary" href="/admin/inventario">Volver a inventario</Link>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card warehouse-selector-card">
        <form method="get" className="warehouse-selector-form">
          <label>Bodega
            <select name="warehouseId" defaultValue={selectedWarehouse.id}>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}{warehouse.active ? "" : " · INACTIVA"}</option>)}
            </select>
          </label>
          <button className="admin-button admin-button-secondary" type="submit">Abrir bodega</button>
        </form>
        <div className="warehouse-map-summary">
          <div><strong>{stocked.length}</strong><span>productos con stock</span></div>
          <div><strong>{locatedProducts}</strong><span>productos ubicados</span></div>
          <div><strong>{placementRows.length}</strong><span>posiciones con existencia</span></div>
          <div className={pendingProducts > 0 ? "is-warning" : ""}><strong>{pendingProducts}</strong><span>productos por ubicar</span></div>
        </div>
      </section>

      <section className="admin-card warehouse-dimensions-card">
        <div className="admin-card-heading"><div><h2>Dimensiones reales</h2><p>Configura ancho, largo/profundidad y altura máxima en metros.</p></div></div>
        <form action={saveWarehouseDimensions} className="admin-form admin-grid admin-grid-3 warehouse-dimensions-form">
          <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
          <label>Ancho (m)<input name="widthM" type="number" min="1" max="500" step="0.1" required defaultValue={layout ? meters(layout.widthCm) : "18"} /></label>
          <label>Largo / profundidad (m)<input name="depthM" type="number" min="1" max="500" step="0.1" required defaultValue={layout ? meters(layout.depthCm) : "32"} /></label>
          <label>Altura (m)<input name="heightM" type="number" min="1" max="100" step="0.1" required defaultValue={layout ? meters(layout.heightCm) : "5"} /></label>
          <button className="admin-button admin-button-primary" type="submit">Guardar dimensiones</button>
        </form>
      </section>

      {layout ? (
        <Warehouse3DEditor warehouseId={selectedWarehouse.id} widthCm={layout.widthCm} depthCm={layout.depthCm} heightCm={layout.heightCm} initialObjects={sceneObjects} />
      ) : (
        <section className="admin-card warehouse-map-empty"><h2>Configura las dimensiones para comenzar</h2><p>Al guardar las medidas se habilitará el editor de planta y la vista WebGL 3D.</p></section>
      )}

      <section className="admin-card warehouse-product-location-card">
        <div className="admin-card-heading"><div><h2>Existencias por ubicación</h2><p>El inventario físico sigue siendo la fuente oficial. Aquí distribuyes ese total entre racks, cámaras y otras posiciones.</p></div></div>
        {!layout || layout.objects.length === 0 ? (
          <div className="admin-inline-notice">Dibuja y guarda al menos un rack, cámara u otro objeto antes de distribuir existencias.</div>
        ) : (
          <div className="warehouse-location-products">
            {stocked.length === 0 && <div className="pos-empty">Esta bodega todavía no tiene productos con existencia.</div>}
            {stocked.map((stock) => {
              const productPlacements = placementsByProduct.get(stock.productId) ?? [];
              const located = productPlacements.reduce((sum, placement) => sum + placement.quantity, 0);
              const unlocated = Math.max(0, stock.onHand - located);
              const available = Math.max(0, stock.onHand - stock.reserved);
              return (
                <article className="warehouse-location-product" key={stock.id}>
                  <div className="warehouse-location-product-head">
                    <Image src={stock.product.imageUrl} alt={stock.product.name} width={72} height={72} />
                    <div>
                      <strong>{stock.product.name}</strong>
                      <span>Físico <b>{stock.onHand} {unitLabel(stock.product.unit)}</b> · Reservado {stock.reserved} · Disponible {available}</span>
                      <span>Ubicado <b>{located}</b> · Sin ubicar <b className={unlocated > 0 ? "warehouse-pending" : ""}>{unlocated} {unitLabel(stock.product.unit)}</b></span>
                    </div>
                  </div>

                  {unlocated > 0 && (
                    <form action={assignWarehouseProduct} className="warehouse-location-allocate">
                      <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
                      <input type="hidden" name="productId" value={stock.productId} />
                      <label>Ubicar stock pendiente
                        <select name="objectId" required defaultValue=""><option value="" disabled>Rack / cámara / posición</option>{layout.objects.map((object) => <option value={object.id} key={object.id}>{object.label}</option>)}</select>
                      </label>
                      <label>Código<input name="locationCode" maxLength={80} placeholder="Ej: A-02-03" /></label>
                      <label>Cantidad<input name="quantity" type="number" min="1" max={unlocated} step="1" required defaultValue={unlocated} /></label>
                      <button className="admin-button admin-button-primary" type="submit">Asignar</button>
                    </form>
                  )}

                  <div className="warehouse-location-list">
                    {productPlacements.length === 0 && <div className="warehouse-location-empty">Todo el stock físico está pendiente de ubicación.</div>}
                    {productPlacements.map((placement) => (
                      <div className="warehouse-location-row" key={placement.id}>
                        <div className="warehouse-location-current">
                          <span>{placement.objectLabel}</span>
                          <strong>{placement.locationCode || "Sin código"}</strong>
                          <b>{placement.quantity} {unitLabel(stock.product.unit)}</b>
                        </div>

                        <form action={moveWarehouseLocationStock} className="warehouse-location-move-form">
                          <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
                          <input type="hidden" name="sourcePlacementId" value={placement.id} />
                          <select name="targetObjectId" required defaultValue=""><option value="" disabled>Mover a…</option>{layout.objects.map((object) => <option value={object.id} key={object.id}>{object.label}</option>)}</select>
                          <input name="targetLocationCode" maxLength={80} placeholder="Código destino" />
                          <input name="quantity" type="number" min="1" max={placement.quantity} step="1" required defaultValue={placement.quantity} aria-label="Cantidad a mover" />
                          <input name="note" maxLength={500} placeholder="Motivo opcional" />
                          <button className="admin-button admin-button-secondary" type="submit">Mover</button>
                        </form>

                        <form action={adjustWarehouseProductPlacementQuantity} className="warehouse-location-adjust-form">
                          <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
                          <input type="hidden" name="placementId" value={placement.id} />
                          <input name="newQuantity" type="number" min="0" max={stock.onHand - located + placement.quantity} step="1" required defaultValue={placement.quantity} aria-label="Cantidad ubicada" />
                          <input name="note" maxLength={500} placeholder="Motivo del ajuste" />
                          <button className="warehouse-inline-action" type="submit">Ajustar</button>
                        </form>

                        <form action={removeWarehouseProductPlacement}>
                          <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
                          <input type="hidden" name="placementId" value={placement.id} />
                          <button className="warehouse-unassign-button" type="submit">Dejar sin ubicar</button>
                        </form>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="admin-card warehouse-location-history">
        <div className="admin-card-heading"><div><h2>Historial de movimientos internos</h2><p>Últimos 100 eventos de ubicación, transferencias internas y reconciliaciones automáticas.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Ubicado después</th><th>Referencia</th><th>Actor</th></tr></thead>
            <tbody>
              {locationMovements.length === 0 && <tr><td colSpan={9}>Aún no hay movimientos internos registrados.</td></tr>}
              {locationMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>{movement.createdAt.toLocaleString("es-CL")}</td>
                  <td><strong>{movement.product.name}</strong>{movement.note && <small>{movement.note}</small>}</td>
                  <td>{movementLabels[movement.type] ?? movement.type}</td>
                  <td>{placeLabel(movement.fromObjectLabel, movement.fromLocationCode)}</td>
                  <td>{placeLabel(movement.toObjectLabel, movement.toLocationCode)}</td>
                  <td className={movement.quantity < 0 ? "admin-qty-negative" : "admin-qty-positive"}>{movement.quantity > 0 ? "+" : ""}{movement.quantity} {unitLabel(movement.product.unit)}</td>
                  <td>{movement.locatedAfter} {unitLabel(movement.product.unit)}</td>
                  <td><small>{movement.reference ?? "—"}</small></td>
                  <td>{movement.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
