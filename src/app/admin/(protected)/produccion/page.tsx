import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ProductionProcessType, UnitType } from "@prisma/client";
import { ProductionBuilder } from "@/components/admin/production-builder";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { formatQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const processLabel: Record<ProductionProcessType, string> = {
  DESPOSTE: "Desposte",
  PORCIONADO: "Porcionado",
  MOLIENDA: "Molienda",
  ENVASADO: "Envasado",
  ELABORACION: "Elaboración",
  OTRO: "Otro",
};

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const query = await searchParams;
  const [warehouses, lotStocks, products, batches] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, code: true } }),
    prisma.inventoryLotStock.findMany({
      where: { onHand: { gt: 0 }, warehouse: { active: true }, lot: { product: { active: true, unit: UnitType.KG } } },
      include: { warehouse: { select: { id: true } }, lot: { include: { product: { select: { id: true, name: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    }),
    prisma.product.findMany({ where: { active: true, unit: UnitType.KG }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productionBatch.findMany({
      include: { warehouse: { select: { name: true, code: true } }, _count: { select: { inputs: true, outputs: true, wastes: true } } },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ]);

  const totalInput = batches.reduce((sum, batch) => sum + toQuantityNumber(batch.totalInputQuantity), 0);
  const totalWaste = batches.reduce((sum, batch) => sum + toQuantityNumber(batch.totalWasteQuantity), 0);
  const weightedYield = totalInput > 0
    ? batches.reduce((sum, batch) => sum + toQuantityNumber(batch.totalOutputQuantity), 0) / totalInput * 100
    : 0;
  const costed = batches.filter((batch) => batch.totalInputCost != null);
  const totalCost = costed.reduce((sum, batch) => sum + (batch.totalInputCost ?? 0), 0);

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Producción y rendimiento</span>
          <h1>Desposte, merma y transformación</h1>
          <p>Convierte lotes físicos en nuevos cortes manteniendo balance, costo y trazabilidad de origen.</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/lotes">Lotes y vencimientos</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/inventario/mapa">Mapa WMS</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{batches.length}</strong><span>procesos recientes</span></div>
        <div className="admin-stat"><strong>{formatQuantity(totalInput, "KG")}</strong><span>materia prima procesada</span></div>
        <div className="admin-stat"><strong>{formatQuantity(totalWaste, "KG")}</strong><span>merma registrada</span></div>
        <div className="admin-stat"><strong>{weightedYield.toLocaleString("es-CL", { maximumFractionDigits: 2 })}%</strong><span>rendimiento ponderado</span></div>
        <div className="admin-stat"><strong>{costed.length > 0 ? formatClp(totalCost) : "—"}</strong><span>costo conocido procesado</span></div>
      </section>

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading">
          <div>
            <h2>Registrar producción</h2>
            <p>Por ahora el balance productivo se controla en kilogramos, que es la unidad física adecuada para desposte y cortes cárnicos.</p>
          </div>
        </div>
        {warehouses.length === 0 || products.length === 0 || lotStocks.length === 0 ? (
          <div className="admin-inline-notice">Necesitas al menos una bodega activa, productos KG y un lote con saldo disponible antes de registrar producción.</div>
        ) : (
          <ProductionBuilder
            requestKey={randomUUID()}
            warehouses={warehouses}
            products={products}
            defaultActor={process.env.ADMIN_USERNAME?.trim() || "admin"}
            lots={lotStocks.map((stock) => ({
              id: stock.lot.id,
              warehouseId: stock.warehouseId,
              productId: stock.lot.productId,
              productName: stock.lot.product.name,
              internalCode: stock.lot.internalCode,
              supplierLotNumber: stock.lot.supplierLotNumber,
              available: toQuantityNumber(stock.onHand),
              expirationDate: stock.lot.expirationDate ? stock.lot.expirationDate.toISOString().slice(0, 10) : null,
              unitCostNet: stock.lot.unitCostNet,
            }))}
          />
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Historial de producción</h2><p>Cada proceso es inmutable y enlaza sus lotes de entrada con los lotes producidos.</p></div></div>
        {batches.length === 0 ? <div className="pos-empty">Todavía no hay procesos registrados.</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Proceso</th><th>Fecha</th><th>Bodega</th><th>Entrada</th><th>Salida</th><th>Merma</th><th>Rendimiento</th><th>Costo</th><th /></tr></thead>
              <tbody>
                {batches.map((batch) => <tr key={batch.id}>
                  <td><strong>{batch.productionNumber}</strong><small>{processLabel[batch.processType]} · {batch.performedBy}</small></td>
                  <td>{batch.createdAt.toLocaleString("es-CL")}</td>
                  <td>{batch.warehouse.name}<small>{batch.warehouse.code}</small></td>
                  <td>{formatQuantity(batch.totalInputQuantity, "KG")}<small>{batch._count.inputs} lote(s)</small></td>
                  <td>{formatQuantity(batch.totalOutputQuantity, "KG")}<small>{batch._count.outputs} producto(s)</small></td>
                  <td>{formatQuantity(batch.totalWasteQuantity, "KG")}<small>{batch._count.wastes} registro(s)</small></td>
                  <td>{toQuantityNumber(batch.yieldPercent).toLocaleString("es-CL", { maximumFractionDigits: 3 })}%</td>
                  <td>{batch.totalInputCost == null ? "Sin costo completo" : formatClp(batch.totalInputCost)}</td>
                  <td><Link className="admin-button admin-button-secondary" href={`/admin/produccion/${batch.id}`}>Trazabilidad</Link></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
