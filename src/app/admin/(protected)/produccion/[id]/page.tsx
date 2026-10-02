import Link from "next/link";
import { ProductionProcessType, ProductionWasteType } from "@prisma/client";
import { notFound } from "next/navigation";
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

const wasteLabel: Record<ProductionWasteType, string> = {
  RECORTE: "Recorte no aprovechable",
  HUESO: "Hueso",
  GRASA: "Grasa / descarte",
  MERMA_PROCESO: "Merma de proceso",
  DERRAME: "Derrame / pérdida",
  DETERIORO: "Deterioro",
  OTRO: "Otro",
};

function date(value: Date | null): string {
  return value ? value.toLocaleDateString("es-CL") : "Sin fecha";
}

export default async function ProductionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: {
      warehouse: true,
      inputs: {
        include: {
          lot: {
            include: {
              supplier: { select: { name: true, code: true } },
              purchaseReceiptItem: {
                include: {
                  purchaseReceipt: { select: { receiptNumber: true, supplierDocumentNumber: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      outputs: { include: { lot: true }, orderBy: { createdAt: "asc" } },
      wastes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!batch) notFound();

  const allocatedOutputCost = batch.outputs.reduce((sum, output) => sum + (output.allocatedCostNet ?? 0), 0);
  const costComplete = batch.totalInputCost != null && batch.outputs.every((output) => output.allocatedCostNet != null);

  return (
    <div className="admin-content admin-content-narrow">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Trazabilidad de producción</span>
          <h1>{batch.productionNumber}</h1>
          <p>{processLabel[batch.processType]} · {batch.warehouse.name} · {batch.performedBy}</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/produccion">← Producción</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/lotes">Lotes</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{formatQuantity(batch.totalInputQuantity, "KG")}</strong><span>entrada física</span></div>
        <div className="admin-stat"><strong>{formatQuantity(batch.totalOutputQuantity, "KG")}</strong><span>producto obtenido</span></div>
        <div className="admin-stat"><strong>{formatQuantity(batch.totalWasteQuantity, "KG")}</strong><span>merma</span></div>
        <div className="admin-stat"><strong>{toQuantityNumber(batch.yieldPercent).toLocaleString("es-CL", { maximumFractionDigits: 3 })}%</strong><span>rendimiento</span></div>
        <div className="admin-stat"><strong>{batch.totalInputCost == null ? "—" : formatClp(batch.totalInputCost)}</strong><span>costo materia prima</span></div>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Datos del proceso</h2><p>Registro inmutable del evento productivo.</p></div></div>
        <div className="admin-grid admin-grid-3">
          <div><small>Tipo</small><strong>{processLabel[batch.processType]}</strong></div>
          <div><small>Bodega</small><strong>{batch.warehouse.name}</strong><p>{batch.warehouse.code}</p></div>
          <div><small>Fecha</small><strong>{batch.createdAt.toLocaleString("es-CL")}</strong></div>
          <div><small>Responsable</small><strong>{batch.performedBy}</strong></div>
          <div><small>Request key</small><strong>{batch.requestKey}</strong></div>
          <div><small>Balance</small><strong>{formatQuantity(batch.totalInputQuantity, "KG")} = {formatQuantity(batch.totalOutputQuantity, "KG")} + {formatQuantity(batch.totalWasteQuantity, "KG")}</strong></div>
        </div>
        {batch.notes && <div className="admin-inline-notice"><strong>Observaciones:</strong> {batch.notes}</div>}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Materia prima / lotes padre</h2><p>Estos son los lotes exactos descontados para fabricar los resultados.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Producto</th><th>Lote interno</th><th>Lote proveedor</th><th>Proveedor / recepción</th><th>Consumido</th><th>Vencimiento</th><th>Costo</th></tr></thead>
            <tbody>
              {batch.inputs.map((input) => <tr key={input.id}>
                <td><strong>{input.productName}</strong></td>
                <td><strong>{input.lot.internalCode}</strong></td>
                <td>{input.lot.supplierLotNumber ?? "—"}</td>
                <td>
                  {input.lot.supplier?.name ?? "Sin proveedor trazado"}
                  <small>{input.lot.purchaseReceiptItem?.purchaseReceipt.receiptNumber ?? "Sin recepción origen"}{input.lot.purchaseReceiptItem?.purchaseReceipt.supplierDocumentNumber ? ` · doc. ${input.lot.purchaseReceiptItem.purchaseReceipt.supplierDocumentNumber}` : ""}</small>
                </td>
                <td>{formatQuantity(input.quantity, input.unit)}</td>
                <td>{date(input.lot.expirationDate)}</td>
                <td>{input.totalCostNet == null ? "Sin costo histórico" : <><strong>{formatClp(input.totalCostNet)}</strong><small>{input.unitCostNet == null ? "" : `${formatClp(input.unitCostNet)}/kg`}</small></>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Productos terminados / lotes hijos</h2><p>Los nuevos lotes quedan disponibles en la bodega pero sin ubicación WMS hasta su asignación física.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Producto</th><th>Nuevo lote</th><th>Cantidad</th><th>Elaboración</th><th>Vencimiento</th><th>Costo asignado</th><th>Costo/kg</th></tr></thead>
            <tbody>
              {batch.outputs.map((output) => <tr key={output.id}>
                <td><strong>{output.productName}</strong></td>
                <td><strong>{output.lot.internalCode}</strong></td>
                <td>{formatQuantity(output.quantity, output.unit)}</td>
                <td>{date(output.manufacturedAt)}</td>
                <td>{date(output.expirationDate)}</td>
                <td>{output.allocatedCostNet == null ? "—" : formatClp(output.allocatedCostNet)}</td>
                <td>{output.unitCostNet == null ? "—" : `${formatClp(output.unitCostNet)}/kg`}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {costComplete && (
          <div className={allocatedOutputCost === batch.totalInputCost ? "admin-alert admin-alert-ok" : "admin-alert admin-alert-error"}>
            Costo reconciliado: materia prima {formatClp(batch.totalInputCost ?? 0)} → lotes hijos {formatClp(allocatedOutputCost)}.
          </div>
        )}
        {!costComplete && <div className="admin-inline-notice">Al menos un lote de entrada no posee costo histórico. El balance físico sigue siendo válido, pero no se inventó un costo para los lotes hijos.</div>}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Merma y descarte</h2><p>Parte no convertida en inventario vendible.</p></div></div>
        {batch.wastes.length === 0 ? <div className="pos-empty">El proceso no registró merma.</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Tipo</th><th>Producto origen</th><th>Cantidad</th><th>Observación</th></tr></thead>
              <tbody>
                {batch.wastes.map((waste) => <tr key={waste.id}>
                  <td><strong>{wasteLabel[waste.type]}</strong></td>
                  <td>{waste.sourceProductName ?? "General"}</td>
                  <td>{formatQuantity(waste.quantity, "KG")}</td>
                  <td>{waste.note ?? "—"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Cadena de trazabilidad</h2><p>Lectura resumida para auditoría o retiro de producto.</p></div></div>
        <div className="admin-inline-notice">
          {batch.inputs.map((input) => `${input.lot.supplierLotNumber || input.lot.internalCode} (${input.productName})`).join(" + ")}
          <strong> → {batch.productionNumber} → </strong>
          {batch.outputs.map((output) => `${output.lot.internalCode} (${output.productName})`).join(" + ")}
        </div>
      </section>
    </div>
  );
}
