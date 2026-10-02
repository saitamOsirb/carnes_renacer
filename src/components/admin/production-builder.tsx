"use client";

import { useMemo, useState } from "react";
import { createProductionAction } from "@/app/admin/production-actions";

type WarehouseOption = { id: string; name: string; code: string };
type LotOption = {
  id: string;
  warehouseId: string;
  productId: string;
  productName: string;
  internalCode: string;
  supplierLotNumber: string | null;
  available: number;
  expirationDate: string | null;
  unitCostNet: number | null;
};
type ProductOption = { id: string; name: string };

type Props = {
  requestKey: string;
  warehouses: WarehouseOption[];
  lots: LotOption[];
  products: ProductOption[];
  defaultActor: string;
};

type InputLine = { key: string; lotId: string; quantity: string };
type OutputLine = { key: string; productId: string; quantity: string; manufacturedAt: string; expirationDate: string };
type WasteLine = { key: string; type: string; quantity: string; sourceProductId: string; note: string };

const processOptions = [
  ["DESPOSTE", "Desposte"],
  ["PORCIONADO", "Porcionado"],
  ["MOLIENDA", "Molienda"],
  ["ENVASADO", "Envasado"],
  ["ELABORACION", "Elaboración"],
  ["OTRO", "Otro"],
] as const;

const wasteOptions = [
  ["RECORTE", "Recorte no aprovechable"],
  ["HUESO", "Hueso"],
  ["GRASA", "Grasa / descarte"],
  ["MERMA_PROCESO", "Merma de proceso"],
  ["DERRAME", "Derrame / pérdida"],
  ["DETERIORO", "Deterioro"],
  ["OTRO", "Otro"],
] as const;

function key(): string {
  return Math.random().toString(36).slice(2, 10);
}

function q(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : 0;
}

function formatKg(value: number): string {
  return new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(value) + " kg";
}

function formatClp(value: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

export function ProductionBuilder({ requestKey, warehouses, lots, products, defaultActor }: Props) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [inputs, setInputs] = useState<InputLine[]>([{ key: key(), lotId: "", quantity: "" }]);
  const [outputs, setOutputs] = useState<OutputLine[]>([{ key: key(), productId: "", quantity: "", manufacturedAt: "", expirationDate: "" }]);
  const [wastes, setWastes] = useState<WasteLine[]>([{ key: key(), type: "MERMA_PROCESO", quantity: "", sourceProductId: "", note: "" }]);

  const availableLots = useMemo(() => lots.filter((lot) => lot.warehouseId === warehouseId && lot.available > 0), [lots, warehouseId]);
  const selectedSourceProducts = useMemo(() => {
    const ids = new Set(inputs.map((line) => availableLots.find((lot) => lot.id === line.lotId)?.productId).filter(Boolean) as string[]);
    return products.filter((product) => ids.has(product.id));
  }, [inputs, availableLots, products]);

  const inputTotal = inputs.reduce((sum, line) => sum + q(line.quantity), 0);
  const outputTotal = outputs.reduce((sum, line) => sum + q(line.quantity), 0);
  const wasteTotal = wastes.reduce((sum, line) => sum + q(line.quantity), 0);
  const difference = Math.round((inputTotal - outputTotal - wasteTotal) * 1000) / 1000;
  const yieldPercent = inputTotal > 0 ? Math.round((outputTotal / inputTotal) * 100000) / 1000 : 0;

  const serializedInputs = inputs.filter((line) => line.lotId && q(line.quantity) > 0).map((line) => ({ lotId: line.lotId, quantity: q(line.quantity) }));
  const serializedOutputs = outputs.filter((line) => line.productId && q(line.quantity) > 0).map((line) => ({
    productId: line.productId,
    quantity: q(line.quantity),
    manufacturedAt: line.manufacturedAt || null,
    expirationDate: line.expirationDate || null,
  }));
  const serializedWastes = wastes.filter((line) => q(line.quantity) > 0).map((line) => ({
    type: line.type,
    quantity: q(line.quantity),
    sourceProductId: line.sourceProductId || null,
    note: line.note || null,
  }));

  function changeWarehouse(next: string) {
    setWarehouseId(next);
    setInputs([{ key: key(), lotId: "", quantity: "" }]);
    setWastes([{ key: key(), type: "MERMA_PROCESO", quantity: "", sourceProductId: "", note: "" }]);
  }

  return (
    <form action={createProductionAction} className="admin-form">
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="inputsJson" value={JSON.stringify(serializedInputs)} />
      <input type="hidden" name="outputsJson" value={JSON.stringify(serializedOutputs)} />
      <input type="hidden" name="wastesJson" value={JSON.stringify(serializedWastes)} />

      <div className="admin-grid admin-grid-3">
        <label>Bodega de proceso
          <select name="warehouseId" value={warehouseId} onChange={(event) => changeWarehouse(event.target.value)} required>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}
          </select>
        </label>
        <label>Proceso
          <select name="processType" defaultValue="DESPOSTE">
            {processOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Responsable<input name="performedBy" defaultValue={defaultActor} maxLength={80} required /></label>
        <label className="admin-grid-span-3">Observaciones<input name="notes" maxLength={1000} placeholder="Ej. desposte de canal, turno, sala, observaciones sanitarias" /></label>
      </div>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h3>1. Lotes de entrada</h3><p>Selecciona exactamente los lotes físicos que ingresan al proceso.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Lote origen</th><th>Disponible</th><th>Costo neto</th><th>Procesar kg</th><th /></tr></thead>
            <tbody>
              {inputs.map((line, index) => {
                const selected = availableLots.find((lot) => lot.id === line.lotId);
                return <tr key={line.key}>
                  <td>
                    <select value={line.lotId} onChange={(event) => setInputs((current) => current.map((item, i) => i === index ? { ...item, lotId: event.target.value } : item))} required>
                      <option value="">Seleccionar lote...</option>
                      {availableLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.productName} · {lot.supplierLotNumber || lot.internalCode}{lot.expirationDate ? ` · vence ${lot.expirationDate}` : ""}</option>)}
                    </select>
                  </td>
                  <td>{selected ? formatKg(selected.available) : "—"}</td>
                  <td>{selected?.unitCostNet != null ? `${formatClp(selected.unitCostNet)}/kg` : "Sin costo histórico"}</td>
                  <td><input type="number" min="0.001" max={selected?.available} step="0.001" value={line.quantity} onChange={(event) => setInputs((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} required /></td>
                  <td><button type="button" className="admin-button admin-button-secondary" disabled={inputs.length === 1} onClick={() => setInputs((current) => current.filter((_, i) => i !== index))}>Quitar</button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="admin-button admin-button-secondary" onClick={() => setInputs((current) => [...current, { key: key(), lotId: "", quantity: "" }])}>+ Agregar lote</button>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h3>2. Cortes / productos resultantes</h3><p>Cada salida genera un nuevo lote trazable y queda inicialmente sin ubicación WMS.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Producto resultado</th><th>kg obtenidos</th><th>Elaboración</th><th>Vencimiento</th><th /></tr></thead>
            <tbody>
              {outputs.map((line, index) => <tr key={line.key}>
                <td><select value={line.productId} onChange={(event) => setOutputs((current) => current.map((item, i) => i === index ? { ...item, productId: event.target.value } : item))} required><option value="">Seleccionar producto...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td>
                <td><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setOutputs((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} required /></td>
                <td><input type="date" value={line.manufacturedAt} onChange={(event) => setOutputs((current) => current.map((item, i) => i === index ? { ...item, manufacturedAt: event.target.value } : item))} /></td>
                <td><input type="date" value={line.expirationDate} onChange={(event) => setOutputs((current) => current.map((item, i) => i === index ? { ...item, expirationDate: event.target.value } : item))} /></td>
                <td><button type="button" className="admin-button admin-button-secondary" disabled={outputs.length === 1} onClick={() => setOutputs((current) => current.filter((_, i) => i !== index))}>Quitar</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <button type="button" className="admin-button admin-button-secondary" onClick={() => setOutputs((current) => [...current, { key: key(), productId: "", quantity: "", manufacturedAt: "", expirationDate: "" }])}>+ Agregar corte</button>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h3>3. Merma / descarte</h3><p>La merma completa el balance físico. No genera stock vendible.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Tipo</th><th>Origen opcional</th><th>kg</th><th>Observación</th><th /></tr></thead>
            <tbody>
              {wastes.map((line, index) => <tr key={line.key}>
                <td><select value={line.type} onChange={(event) => setWastes((current) => current.map((item, i) => i === index ? { ...item, type: event.target.value } : item))}>{wasteOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td><select value={line.sourceProductId} onChange={(event) => setWastes((current) => current.map((item, i) => i === index ? { ...item, sourceProductId: event.target.value } : item))}><option value="">General</option>{selectedSourceProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td>
                <td><input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setWastes((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} /></td>
                <td><input value={line.note} maxLength={500} onChange={(event) => setWastes((current) => current.map((item, i) => i === index ? { ...item, note: event.target.value } : item))} /></td>
                <td><button type="button" className="admin-button admin-button-secondary" onClick={() => setWastes((current) => current.filter((_, i) => i !== index))}>Quitar</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <button type="button" className="admin-button admin-button-secondary" onClick={() => setWastes((current) => [...current, { key: key(), type: "MERMA_PROCESO", quantity: "", sourceProductId: "", note: "" }])}>+ Agregar merma</button>
      </section>

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{formatKg(inputTotal)}</strong><span>entrada</span></div>
        <div className="admin-stat"><strong>{formatKg(outputTotal)}</strong><span>producto vendible</span></div>
        <div className="admin-stat"><strong>{formatKg(wasteTotal)}</strong><span>merma</span></div>
        <div className="admin-stat"><strong>{yieldPercent.toLocaleString("es-CL", { maximumFractionDigits: 3 })}%</strong><span>rendimiento</span></div>
      </section>

      <div className={Math.abs(difference) < 0.0001 && inputTotal > 0 ? "admin-alert admin-alert-ok" : "admin-alert admin-alert-error"}>
        {inputTotal <= 0
          ? "Ingresa materia prima para comenzar el balance."
          : Math.abs(difference) < 0.0001
            ? "Balance físico cuadrado: entradas = productos + merma."
            : `Faltan cuadrar ${formatKg(Math.abs(difference))} (${difference > 0 ? "debes asignarlos a salida o merma" : "las salidas superan la entrada"}).`}
      </div>

      <button className="admin-button admin-button-primary" type="submit" disabled={inputTotal <= 0 || Math.abs(difference) >= 0.0001}>Confirmar producción y mover inventario</button>
    </form>
  );
}
