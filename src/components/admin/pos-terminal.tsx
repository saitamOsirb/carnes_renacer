"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPosSaleAction } from "@/app/admin/pos-actions";
import { formatClp } from "@/lib/format";
import {
  calculateQuantitySubtotal,
  formatQuantity,
  normalizeQuantity,
  roundQuantity,
} from "@/lib/quantity";

type PosProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  price: number;
  unit: "KG" | "UNIT";
  available: number;
};

type PosCustomer = {
  id: string;
  name: string;
  rut: string | null;
  email: string | null;
  phone: string | null;
};

type PosTerminalProps = {
  shiftId: string;
  registerName: string;
  cashierName: string;
  warehouseName: string;
  products: PosProduct[];
  customers: PosCustomer[];
};

type CartLine = { productId: string; quantity: number };
type ScanTone = "idle" | "success" | "warning" | "error";
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new () => BarcodeDetectorLike;
type ResolverResponse = { productId?: string; barcode?: string; error?: string };

function unitLabel(unit: PosProduct["unit"]): string {
  return unit === "KG" ? "kg" : "un.";
}

function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase().slice(0, 80);
}

function quickStep(product: PosProduct): number {
  return product.unit === "KG" ? 0.1 : 1;
}

function initialQuantity(product: PosProduct): number {
  return normalizeQuantity(Math.min(1, product.available), product.unit, product.available);
}

export function PosTerminal({ shiftId, registerName, cashierName, warehouseName, products, customers }: PosTerminalProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [cart, setCart] = useState<CartLine[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [amountReceived, setAmountReceived] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanMessage, setScanMessage] = useState("Lector listo. Escanea un código y presiona Enter.");
  const [scanTone, setScanTone] = useState<ScanTone>("idle");
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const resolveBusyRef = useRef(false);

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const categories = useMemo(() => [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b, "es")), [products]);
  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return products.filter((product) => {
      if (category !== "ALL" && product.category !== category) return false;
      if (!term) return true;
      return `${product.name} ${product.category}`.toLocaleLowerCase("es").includes(term);
    });
  }, [products, search, category]);

  useEffect(() => {
    const detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    setCameraSupported(Boolean(detector && navigator.mediaDevices?.getUserMedia));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F8") {
        event.preventDefault();
        barcodeRef.current?.focus();
        barcodeRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => () => stopCamera(), []);

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const cartDetailed = cart.flatMap((line) => {
    const product = productMap.get(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const subtotal = cartDetailed.reduce((sum, line) => sum + calculateQuantitySubtotal(line.product.price, line.quantity), 0);
  const discountValue = Math.min(subtotal, Math.max(0, Number.parseInt(discount || "0", 10) || 0));
  const total = subtotal - discountValue;
  const received = Math.max(0, Number.parseInt(amountReceived || "0", 10) || 0);
  const change = paymentMethod === "CASH" ? Math.max(0, received - total) : 0;
  const cashInsufficient = paymentMethod === "CASH" && received < total;

  function replaceCart(next: CartLine[]) {
    cartRef.current = next;
    setCart(next);
  }

  function addProduct(product: PosProduct, source: "manual" | "scanner" = "manual", barcode = "") {
    if (product.available <= 0) {
      if (source === "scanner") {
        setScanTone("error");
        setScanMessage(`${product.name}: sin stock disponible en ${warehouseName}.`);
      }
      return;
    }

    const increment = initialQuantity(product);
    if (increment <= 0) return;
    const current = cartRef.current;
    const found = current.find((line) => line.productId === product.id);
    const nextQuantity = normalizeQuantity((found?.quantity ?? 0) + increment, product.unit, product.available);
    if (found && nextQuantity <= found.quantity) {
      if (source === "scanner") {
        setScanTone("warning");
        setScanMessage(`${product.name}: ya alcanzaste el máximo disponible (${formatQuantity(product.available, product.unit)}).`);
      }
      return;
    }

    replaceCart(found
      ? current.map((line) => line.productId === product.id ? { ...line, quantity: nextQuantity } : line)
      : [...current, { productId: product.id, quantity: increment }]);

    if (source === "scanner") {
      setScanTone("success");
      setScanMessage(`${barcode ? `${barcode} · ` : ""}${product.name} agregado. Cantidad: ${formatQuantity(nextQuantity, product.unit)}.`);
    }
  }

  function updateQuantity(product: PosProduct, quantity: number) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      replaceCart(cartRef.current.filter((line) => line.productId !== product.id));
      return;
    }
    const safeQuantity = normalizeQuantity(quantity, product.unit, product.available);
    if (safeQuantity <= 0) return;
    replaceCart(cartRef.current.map((line) => line.productId === product.id ? { ...line, quantity: safeQuantity } : line));
  }

  function adjustQuantity(product: PosProduct, current: number, direction: -1 | 1) {
    updateQuantity(product, roundQuantity(current + quickStep(product) * direction));
  }

  async function resolveBarcode(raw: string, source: "lector" | "cámara") {
    const code = normalizeBarcode(raw);
    if (!code || resolveBusyRef.current) return;
    if (!/^[A-Z0-9._-]{4,80}$/.test(code)) {
      setScanTone("error");
      setScanMessage("El código leído no tiene un formato válido.");
      setBarcodeInput("");
      barcodeRef.current?.focus();
      return;
    }

    resolveBusyRef.current = true;
    setScanTone("idle");
    setScanMessage(`Buscando ${code}…`);
    try {
      const response = await fetch(`/admin/api/barcode/resolve?code=${encodeURIComponent(code)}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as ResolverResponse;
      if (response.status === 401) {
        setScanTone("error");
        setScanMessage("La sesión administrativa expiró. Vuelve a iniciar sesión antes de continuar vendiendo.");
        return;
      }
      if (!response.ok || !payload.productId) {
        setScanTone("error");
        setScanMessage(payload.error === "Código no registrado." ? `Código ${code} no registrado.` : (payload.error ?? `No fue posible resolver ${code}.`));
        return;
      }
      const product = productMap.get(payload.productId);
      if (!product) {
        setScanTone("warning");
        setScanMessage(`Código ${code} válido, pero el producto no está disponible en ${warehouseName}.`);
        return;
      }
      addProduct(product, "scanner", code);
      if (source === "cámara") stopCamera();
    } catch {
      setScanTone("error");
      setScanMessage("No fue posible consultar el código. Revisa la conexión e intenta nuevamente.");
    } finally {
      resolveBusyRef.current = false;
      setBarcodeInput("");
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  function stopCamera() {
    if (scanFrameRef.current !== null) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    detectBusyRef.current = false;
    setCameraOpen(false);
  }

  async function startCamera() {
    const detectorCtor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!detectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setScanTone("warning");
      setScanMessage("Este navegador no soporta cámara para códigos. Usa el lector USB/Bluetooth.");
      return;
    }
    try {
      stopCamera();
      setCameraOpen(true);
      setScanTone("idle");
      setScanMessage("Abriendo cámara…");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      mediaStreamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("No se encontró el visor de cámara.");
      video.srcObject = stream;
      await video.play();
      const detector = new detectorCtor();
      setScanMessage("Apunta la cámara al código de barras.");
      const scan = async () => {
        if (!mediaStreamRef.current || !videoRef.current) return;
        if (video.readyState >= 2 && !detectBusyRef.current && !resolveBusyRef.current) {
          detectBusyRef.current = true;
          try {
            const detected = await detector.detect(video);
            const code = detected.find((item) => item.rawValue)?.rawValue;
            if (code) {
              await resolveBarcode(code, "cámara");
              return;
            }
          } catch {
            // Un frame puede fallar temporalmente sin invalidar el escáner.
          } finally {
            detectBusyRef.current = false;
          }
        }
        scanFrameRef.current = requestAnimationFrame(scan);
      };
      scanFrameRef.current = requestAnimationFrame(scan);
    } catch (error) {
      stopCamera();
      setScanTone("error");
      setScanMessage(error instanceof Error ? `No fue posible usar la cámara: ${error.message}` : "No fue posible usar la cámara.");
    }
  }

  return (
    <div className="pos-terminal-wrap">
      <div className="pos-shift-banner">
        <div><span>Caja</span><strong>{registerName}</strong></div>
        <div><span>Cajero</span><strong>{cashierName}</strong></div>
        <div><span>Bodega</span><strong>{warehouseName}</strong></div>
        <div><span>Turno</span><strong>{shiftId.slice(-8).toUpperCase()}</strong></div>
      </div>

      <div className="pos-shell">
        <section className="pos-catalog-panel">
          <div className="pos-scanner-panel">
            <label className="pos-scanner-field">Escanear código <small>F8 vuelve a enfocar el lector</small>
              <span className="pos-scanner-input-wrap">
                <input ref={barcodeRef} value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void resolveBarcode(barcodeInput, "lector"); }
                }} placeholder="Escanea o escribe el código y presiona Enter" autoComplete="off" autoFocus />
              </span>
            </label>
            <div className="pos-scanner-actions">
              {cameraSupported && !cameraOpen && <button type="button" className="admin-button admin-button-secondary" onClick={() => void startCamera()}>Usar cámara</button>}
              {cameraOpen && <button type="button" className="admin-button admin-button-secondary" onClick={stopCamera}>Cerrar cámara</button>}
            </div>
            <p className={`pos-scanner-message${scanTone === "success" ? " is-success" : scanTone === "warning" ? " is-warning" : scanTone === "error" ? " is-error" : ""}`}>{scanMessage}</p>
            {cameraOpen && <div className="pos-camera-panel"><video ref={videoRef} muted playsInline /><div className="pos-camera-guide" aria-hidden="true" /></div>}
          </div>

          <div className="pos-toolbar pos-toolbar-single"><label>Buscar producto<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o categoría" /></label></div>
          <div className="pos-category-tabs">
            <button type="button" className={category === "ALL" ? "is-active" : ""} onClick={() => setCategory("ALL")}>Todos</button>
            {categories.map((item) => <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          </div>

          <div className="pos-product-grid">
            {visibleProducts.length === 0 && <div className="pos-empty">No hay productos para este filtro.</div>}
            {visibleProducts.map((product) => (
              <button type="button" key={product.id} className="pos-product-card" disabled={product.available <= 0} onClick={() => addProduct(product)}>
                <Image src={product.imageUrl} alt={product.name} width={150} height={112} sizes="150px" />
                <span className="pos-product-info">
                  <strong>{product.name}</strong><small>{product.category}</small>
                  <span>{formatClp(product.price)} / {unitLabel(product.unit)}</span>
                  <em className={product.available <= 0 ? "is-empty" : ""}>{product.available > 0 ? `${formatQuantity(product.available, product.unit)} disponibles` : "Sin stock"}</em>
                </span>
              </button>
            ))}
          </div>
        </section>

        <form action={createPosSaleAction} className="pos-cart-panel">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="items" value={JSON.stringify(cart)} />
          <input type="hidden" name="discount" value={discountValue} />
          <input type="hidden" name="customerId" value={customerId} />
          <div className="pos-cart-heading"><div><span className="admin-kicker">Caja</span><h2>Venta actual</h2></div>{cart.length > 0 && <button type="button" className="pos-clear-button" onClick={() => replaceCart([])}>Vaciar</button>}</div>

          <div className="pos-cart-lines">
            {cartDetailed.length === 0 && <div className="pos-empty">Selecciona productos para comenzar la venta.</div>}
            {cartDetailed.map((line) => (
              <div className="pos-cart-line" key={line.productId}>
                <div className="pos-cart-line-main">
                  <strong>{line.product.name}</strong>
                  <small>{formatClp(line.product.price)} / {unitLabel(line.product.unit)} × {formatQuantity(line.quantity, line.product.unit)}</small>
                </div>
                <div className="pos-qty-control">
                  <button type="button" onClick={() => adjustQuantity(line.product, line.quantity, -1)}>−</button>
                  <input
                    type="number"
                    min={line.product.unit === "KG" ? "0.001" : "1"}
                    step={line.product.unit === "KG" ? "0.001" : "1"}
                    max={line.product.available}
                    value={line.quantity}
                    onChange={(event) => updateQuantity(line.product, Number(event.target.value))}
                    aria-label={line.product.unit === "KG" ? `Peso en kg de ${line.product.name}` : `Cantidad de ${line.product.name}`}
                  />
                  <button type="button" disabled={line.quantity >= line.product.available} onClick={() => adjustQuantity(line.product, line.quantity, 1)}>+</button>
                </div>
                <strong>{formatClp(calculateQuantitySubtotal(line.product.price, line.quantity))}</strong>
              </div>
            ))}
          </div>

          <div className="pos-customer-grid">
            <label>Cliente registrado <small>(opcional)</small><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Cliente ocasional · no guardar datos personales</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.rut ? ` · ${customer.rut}` : ""}</option>)}
            </select></label>
            <div className="admin-inline-notice">
              {selectedCustomer ? <><strong>{selectedCustomer.name}</strong>{selectedCustomer.rut ? ` · ${selectedCustomer.rut}` : ""}<br /><small>{selectedCustomer.email ?? selectedCustomer.phone ?? "Sin canal de contacto registrado"}</small></> : <>No se almacenarán nombre, RUT, correo ni teléfono para esta venta.</>}
              <br /><a href="/admin/clientes" target="_blank" rel="noreferrer">Registrar o editar cliente</a>
            </div>
          </div>

          <label className="pos-field">Observación de venta <small>(opcional, no ingreses datos sensibles)</small><textarea name="notes" rows={2} maxLength={500} placeholder="Referencia operativa de la venta…" /></label>
          <div className="pos-totals">
            <div><span>Subtotal</span><strong>{formatClp(subtotal)}</strong></div>
            <label><span>Descuento</span><input type="number" min="0" max={subtotal} step="1" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
            <div className="pos-total-final"><span>Total</span><strong>{formatClp(total)}</strong></div>
          </div>
          <div className="pos-payment-grid">
            <label>Medio de pago<select name="paymentMethod" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="CASH">Efectivo</option><option value="DEBIT_CARD">Tarjeta débito</option><option value="CREDIT_CARD">Tarjeta crédito</option><option value="TRANSFER">Transferencia</option><option value="OTHER">Otro</option>
            </select></label>
            {paymentMethod === "CASH" && <label>Monto recibido<input name="amountReceived" type="number" min={total} step="1" value={amountReceived} onChange={(event) => setAmountReceived(event.target.value)} placeholder={String(total)} required /></label>}
          </div>
          {paymentMethod === "CASH" && <div className={`pos-change-box${cashInsufficient ? " is-warning" : ""}`}><span>Vuelto</span><strong>{formatClp(change)}</strong></div>}
          <button className="admin-button admin-button-primary pos-pay-button" type="submit" disabled={cart.length === 0 || total <= 0 || cashInsufficient}>Registrar venta</button>
          <small className="pos-sale-note">Los productos por kg admiten precisión de 0,001 kg. La venta descuenta inventario de {warehouseName}.</small>
        </form>
      </div>
    </div>
  );
}
