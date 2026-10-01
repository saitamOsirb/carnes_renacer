import Image from "next/image";
import Link from "next/link";
import { assignWarehouseProduct, removeWarehouseProductPlacement, saveWarehouseDimensions } from "@/app/admin/warehouse-map-actions";
import { Warehouse3DEditor, type WarehouseSceneObject } from "@/components/admin/warehouse-3d-editor";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function meters(cm: number): string {
  return (cm / 100).toFixed(cm % 100 === 0 ? 0 : 2);
}

function unitLabel(unit: string): string {
  return unit === "KG" ? "kg" : "un.";
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

  const [layout, stocks] = await Promise.all([
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
  ]);

  const stockByProduct = new Map(stocks.map((stock) => [stock.productId, stock]));
  const placements = layout?.objects.flatMap((object) => object.placements.map((placement) => ({ ...placement, objectLabel: object.label }))) ?? [];
  const placementByProduct = new Map(placements.map((placement) => [placement.productId, placement]));

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
        id: placement.product.id,
        name: placement.product.name,
        imageUrl: placement.product.imageUrl,
        available: stock ? Math.max(0, stock.onHand - stock.reserved) : 0,
        onHand: stock?.onHand ?? 0,
        reserved: stock?.reserved ?? 0,
        unit: placement.product.unit,
        locationCode: placement.locationCode,
      };
    }),
  })) ?? [];

  const stocked = stocks.filter((stock) => stock.onHand > 0 || stock.reserved > 0);
  const assignedCount = stocked.filter((stock) => placementByProduct.has(stock.productId)).length;
  const availableTotal = stocked.reduce((sum, stock) => sum + Math.max(0, stock.onHand - stock.reserved), 0);

  return (
    <div className="admin-content warehouse-map-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Inventario visual</span>
          <h1>Mapa 3D de bodega</h1>
          <p>Dibuja la distribución física y ubica productos usando el mismo stock que consume el POS.</p>
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
          <div><strong>{assignedCount}</strong><span>ubicados en mapa</span></div>
          <div><strong>{availableTotal}</strong><span>stock disponible total</span></div>
          <div><strong>{layout?.objects.length ?? 0}</strong><span>objetos dibujados</span></div>
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
        <section className="admin-card warehouse-map-empty"><h2>Configura las dimensiones para comenzar</h2><p>Al guardar las medidas se habilitará el editor de planta y la vista 3D.</p></section>
      )}

      <section className="admin-card warehouse-product-location-card">
        <div className="admin-card-heading"><div><h2>Ubicación de productos</h2><p>La cantidad se lee siempre desde Inventario. Aquí solo defines la posición física dentro de la bodega.</p></div></div>
        {!layout || layout.objects.length === 0 ? (
          <div className="admin-inline-notice">Dibuja y guarda al menos un rack, cámara u otro objeto antes de asignar productos.</div>
        ) : (
          <div className="warehouse-product-location-grid">
            {stocked.length === 0 && <div className="pos-empty">Esta bodega todavía no tiene productos con existencia.</div>}
            {stocked.map((stock) => {
              const placement = placementByProduct.get(stock.productId);
              const available = Math.max(0, stock.onHand - stock.reserved);
              return (
                <article className="warehouse-product-location" key={stock.id}>
                  <Image src={stock.product.imageUrl} alt={stock.product.name} width={72} height={72} />
                  <div className="warehouse-product-location-info">
                    <strong>{stock.product.name}</strong>
                    <span>Físico {stock.onHand} · Reservado {stock.reserved} · <b>Disponible {available} {unitLabel(stock.product.unit)}</b></span>
                    {placement && <small>Actual: {placement.objectLabel}{placement.locationCode ? ` · ${placement.locationCode}` : ""}</small>}
                  </div>
                  <form action={assignWarehouseProduct} className="warehouse-product-location-form">
                    <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
                    <input type="hidden" name="productId" value={stock.productId} />
                    <select name="objectId" required defaultValue={placement?.objectId ?? ""}>
                      <option value="" disabled>Selecciona ubicación</option>
                      {layout.objects.map((object) => <option value={object.id} key={object.id}>{object.label}</option>)}
                    </select>
                    <input name="locationCode" maxLength={80} defaultValue={placement?.locationCode ?? ""} placeholder="Ej: A-02-03" />
                    <button className="admin-button admin-button-secondary" type="submit">Ubicar</button>
                  </form>
                  {placement && (
                    <form action={removeWarehouseProductPlacement}>
                      <input type="hidden" name="warehouseId" value={selectedWarehouse.id} />
                      <input type="hidden" name="productId" value={stock.productId} />
                      <button className="warehouse-unassign-button" type="submit">Quitar del mapa</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
