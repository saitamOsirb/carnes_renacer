"use client";

import { useMemo, useState } from "react";
import { createPurchaseOrderAction } from "@/app/admin/purchase-actions";

type Option = { id: string; label: string };
type ProductOption = { id: string; name: string; unit: "KG" | "UNIT" };
type Line = { key: string; productId: string; quantity: string; unitCostNet: string };

function lineKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function newLine(): Line {
  return { key: lineKey(), productId: "", quantity: "", unitCostNet: "" };
}

function clp(value: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value || 0);
}

export function PurchaseOrderForm({
  requestKey,
  suppliers,
  warehouses,
  products,
  defaultSupplierId,
}: {
  requestKey: string;
  suppliers: Option[];
  warehouses: Option[];
  products: ProductOption[];
  defaultSupplierId?: string;
}) {
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const selectedIds = useMemo(() => new Set(lines.map((line) => line.productId).filter(Boolean)), [lines]);

  const payload = lines
    .filter((line) => line.productId)
    .map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity.replace(",", ".")),
      unitCostNet: Number(line.unitCostNet),
    }));

  const net = payload.reduce((sum, line) => {
    if (!Number.isFinite(line.quantity) || !Number.isFinite(line.unitCostNet)) return sum;
    return sum + Math.round(line.quantity * line.unitCostNet);
  }, 0);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function removeLine(key: string) {
    setLines((current) => current.length === 1 ? [newLine()] : current.filter((line) => line.key !== key));
  }

  return (
    <form action={createPurchaseOrderAction} className="admin-form">
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="itemsJson" value={JSON.stringify(payload)} />

      <div className="admin-grid admin-grid-3">
        <label>Proveedor
          <select name="supplierId" required defaultValue={defaultSupplierId ?? ""}>
            <option value="">Selecciona proveedor</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}
          </select>
        </label>
        <label>Bodega de recepción
          <select name="warehouseId" required defaultValue="">
            <option value="">Selecciona bodega</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}
          </select>
        </label>
        <label>Fecha esperada<input type="date" name="expectedDate" /></label>
        <label>Referencia proveedor<input name="supplierReference" maxLength={100} placeholder="Cotización / pedido proveedor" /></label>
        <label>IVA (%)<input type="number" name="vatRate" min={0} max={100} step={1} defaultValue={19} required /></label>
        <label>Observaciones<input name="notes" maxLength={1000} /></label>
      </div>

      <div className="admin-card-heading">
        <div><h3>Productos solicitados</h3><p>El costo corresponde al valor neto por kg o por unidad.</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={() => setLines((current) => current.length < 100 ? [...current, newLine()] : current)}>+ Agregar producto</button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo neto unit.</th><th>Neto línea</th><th /></tr></thead>
          <tbody>
            {lines.map((line) => {
              const product = productMap.get(line.productId);
              const quantity = Number(line.quantity.replace(",", "."));
              const cost = Number(line.unitCostNet);
              const amount = Number.isFinite(quantity) && Number.isFinite(cost) ? Math.round(quantity * cost) : 0;
              return (
                <tr key={line.key}>
                  <td>
                    <select value={line.productId} onChange={(event) => updateLine(line.key, { productId: event.target.value, quantity: "", unitCostNet: "" })} required>
                      <option value="">Selecciona producto</option>
                      {products.map((option) => <option key={option.id} value={option.id} disabled={selectedIds.has(option.id) && option.id !== line.productId}>{option.name} · {option.unit === "KG" ? "kg" : "unidad"}</option>)}
                    </select>
                  </td>
                  <td><input value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} inputMode="decimal" min={product?.unit === "UNIT" ? 1 : 0.001} step={product?.unit === "UNIT" ? 1 : 0.001} type="number" required placeholder={product?.unit === "KG" ? "0,000 kg" : "0"} /></td>
                  <td><input value={line.unitCostNet} onChange={(event) => updateLine(line.key, { unitCostNet: event.target.value })} type="number" inputMode="numeric" min={1} step={1} required placeholder="$ neto" /></td>
                  <td><strong>{clp(amount)}</strong></td>
                  <td><button className="admin-button admin-button-danger" type="button" onClick={() => removeLine(line.key)}>Quitar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="admin-inline-notice"><strong>Neto estimado:</strong> {clp(net)}. El IVA y total se calculan al crear la orden.</div>
      <button className="admin-button admin-button-primary" type="submit" disabled={payload.length === 0}>Crear orden de compra</button>
    </form>
  );
}
