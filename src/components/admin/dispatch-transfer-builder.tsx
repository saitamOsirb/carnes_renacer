"use client";

import { useMemo, useState } from "react";
import { createTransferDispatchAction } from "@/app/admin/dispatch-actions";

type WarehouseOption = {
  id: string;
  code: string;
  name: string;
  address: string | null;
};

type ProductOption = {
  id: string;
  name: string;
  unit: "KG" | "UNIT";
  price: number;
};

type StockOption = {
  warehouseId: string;
  productId: string;
  available: number;
};

type Line = {
  productId: string;
  quantity: number;
};

function qty(value: number, unit: "KG" | "UNIT"): string {
  return `${value.toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${unit === "KG" ? "kg" : "un."}`;
}

export function DispatchTransferBuilder({
  requestKey,
  warehouses,
  products,
  stocks,
}: {
  requestKey: string;
  warehouses: WarehouseOption[];
  products: ProductOption[];
  stocks: StockOption[];
}) {
  const [sourceId, setSourceId] = useState(warehouses[0]?.id ?? "");
  const [destinationId, setDestinationId] = useState(warehouses[1]?.id ?? "");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [receiverName, setReceiverName] = useState(warehouses[1]?.name ?? "");
  const [receiverAddress, setReceiverAddress] = useState(warehouses[1]?.address ?? "");

  const stockMap = useMemo(() => new Map(stocks.map((stock) => [`${stock.warehouseId}:${stock.productId}`, stock.available])), [stocks]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const sourceProducts = products.filter((product) => (stockMap.get(`${sourceId}:${product.id}`) ?? 0) > 0);

  function changeDestination(id: string) {
    setDestinationId(id);
    const warehouse = warehouses.find((item) => item.id === id);
    if (warehouse) {
      setReceiverName(warehouse.name);
      setReceiverAddress(warehouse.address ?? "");
    }
  }

  function addLine() {
    if (!selectedProductId || lines.some((line) => line.productId === selectedProductId)) return;
    const product = productMap.get(selectedProductId);
    if (!product) return;
    setLines((current) => [...current, { productId: selectedProductId, quantity: product.unit === "KG" ? 0.1 : 1 }]);
    setSelectedProductId("");
  }

  function changeQuantity(productId: string, raw: string) {
    const product = productMap.get(productId);
    const value = Number(raw);
    if (!product || !Number.isFinite(value)) return;
    const normalized = product.unit === "UNIT" ? Math.trunc(value) : Math.round(value * 1000) / 1000;
    setLines((current) => current.map((line) => line.productId === productId ? { ...line, quantity: Math.max(0, normalized) } : line));
  }

  return (
    <form action={createTransferDispatchAction} className="admin-form dispatch-create-form">
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="items" value={JSON.stringify(lines)} />

      <div className="admin-grid admin-grid-2">
        <label>Bodega origen
          <select name="sourceWarehouseId" required value={sourceId} onChange={(event) => { setSourceId(event.target.value); setLines([]); }}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
        <label>Bodega destino
          <select name="destinationWarehouseId" required value={destinationId} onChange={(event) => changeDestination(event.target.value)}>
            {warehouses.filter((warehouse) => warehouse.id !== sourceId).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
      </div>

      <div className="dispatch-line-picker">
        <label>Producto
          <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
            <option value="">Selecciona producto</option>
            {sourceProducts.filter((product) => !lines.some((line) => line.productId === product.id)).map((product) => (
              <option key={product.id} value={product.id}>{product.name} · disponible {qty(stockMap.get(`${sourceId}:${product.id}`) ?? 0, product.unit)}</option>
            ))}
          </select>
        </label>
        <button type="button" className="admin-button admin-button-secondary" onClick={addLine} disabled={!selectedProductId}>Agregar</button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Producto</th><th>Disponible</th><th>Cantidad / peso</th><th /></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={4}>Agrega los productos que viajarán en este traslado.</td></tr>}
            {lines.map((line) => {
              const product = productMap.get(line.productId)!;
              const available = stockMap.get(`${sourceId}:${line.productId}`) ?? 0;
              return <tr key={line.productId}>
                <td><strong>{product.name}</strong><small>{product.unit === "KG" ? "Por kilo" : "Por unidad"}</small></td>
                <td>{qty(available, product.unit)}</td>
                <td><input type="number" min={product.unit === "KG" ? "0.001" : "1"} max={available} step={product.unit === "KG" ? "0.001" : "1"} value={line.quantity} onChange={(event) => changeQuantity(line.productId, event.target.value)} /></td>
                <td><button type="button" className="billing-link" onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}>Quitar</button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      <div className="admin-grid admin-grid-2">
        <label>Motivo del traslado<textarea name="reason" required rows={3} maxLength={500} placeholder="Traslado de mercadería entre bodegas" /></label>
        <label>Código motivo / IndTraslado<input name="transferReasonCode" maxLength={10} placeholder="Completar según configuración/certificación SII" /></label>
        <label>Receptor / destino<input name="receiverName" required maxLength={191} value={receiverName} onChange={(event) => setReceiverName(event.target.value)} /></label>
        <label>RUT receptor<input name="receiverRut" maxLength={20} placeholder="Requerido al habilitar ambiente SII real" /></label>
        <label>Dirección destino<input name="receiverAddress" required maxLength={255} value={receiverAddress} onChange={(event) => setReceiverAddress(event.target.value)} /></label>
        <label>Comuna destino<input name="receiverCommune" required maxLength={120} /></label>
        <label>Ciudad destino<input name="receiverCity" maxLength={120} /></label>
        <label>Giro receptor<input name="receiverGiro" maxLength={191} /></label>
      </div>

      <details className="billing-invoice-form">
        <summary>Transporte y conductor</summary>
        <div className="admin-grid admin-grid-2">
          <label>Patente vehículo<input name="vehiclePlate" maxLength={20} /></label>
          <label>Patente remolque<input name="trailerPlate" maxLength={20} /></label>
          <label>RUT transportista<input name="transportCompanyRut" maxLength={20} /></label>
          <label>Transportista<input name="transportCompanyName" maxLength={191} /></label>
          <label>RUT conductor<input name="driverRut" maxLength={20} /></label>
          <label>Nombre conductor<input name="driverName" maxLength={191} /></label>
        </div>
      </details>

      <label>Observaciones<textarea name="notes" rows={2} maxLength={1000} /></label>
      <button className="admin-button admin-button-primary" type="submit" disabled={lines.length === 0 || !sourceId || !destinationId || sourceId === destinationId}>Crear traslado interno</button>
    </form>
  );
}
