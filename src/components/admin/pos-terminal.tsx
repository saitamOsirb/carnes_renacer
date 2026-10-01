"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { createPosSaleAction } from "@/app/admin/pos-actions";
import { formatClp } from "@/lib/format";

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

type CartLine = {
  productId: string;
  quantity: number;
};

function unitLabel(unit: PosProduct["unit"]): string {
  return unit === "KG" ? "kg" : "un.";
}

export function PosTerminal({ shiftId, registerName, cashierName, warehouseName, products, customers }: PosTerminalProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [amountReceived, setAmountReceived] = useState("");
  const [customerId, setCustomerId] = useState("");

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

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const cartDetailed = cart.flatMap((line) => {
    const product = productMap.get(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const subtotal = cartDetailed.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const discountValue = Math.min(subtotal, Math.max(0, Number.parseInt(discount || "0", 10) || 0));
  const total = subtotal - discountValue;
  const received = Math.max(0, Number.parseInt(amountReceived || "0", 10) || 0);
  const change = paymentMethod === "CASH" ? Math.max(0, received - total) : 0;
  const cashInsufficient = paymentMethod === "CASH" && received < total;

  function addProduct(product: PosProduct) {
    if (product.available <= 0) return;
    setCart((current) => {
      const found = current.find((line) => line.productId === product.id);
      if (!found) return [...current, { productId: product.id, quantity: 1 }];
      if (found.quantity >= product.available) return current;
      return current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
    });
  }

  function updateQuantity(product: PosProduct, quantity: number) {
    if (quantity <= 0) {
      setCart((current) => current.filter((line) => line.productId !== product.id));
      return;
    }
    const safeQuantity = Math.min(product.available, Math.max(1, Math.trunc(quantity)));
    setCart((current) => current.map((line) => line.productId === product.id ? { ...line, quantity: safeQuantity } : line));
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
          <div className="pos-toolbar pos-toolbar-single">
            <label>
              Buscar producto
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o categoría" autoFocus />
            </label>
          </div>

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
                  <strong>{product.name}</strong>
                  <small>{product.category}</small>
                  <span>{formatClp(product.price)} / {unitLabel(product.unit)}</span>
                  <em className={product.available <= 0 ? "is-empty" : ""}>{product.available > 0 ? `${product.available} ${unitLabel(product.unit)} disponibles` : "Sin stock"}</em>
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

          <div className="pos-cart-heading">
            <div><span className="admin-kicker">Caja</span><h2>Venta actual</h2></div>
            {cart.length > 0 && <button type="button" className="pos-clear-button" onClick={() => setCart([])}>Vaciar</button>}
          </div>

          <div className="pos-cart-lines">
            {cartDetailed.length === 0 && <div className="pos-empty">Selecciona productos para comenzar la venta.</div>}
            {cartDetailed.map((line) => (
              <div className="pos-cart-line" key={line.productId}>
                <div className="pos-cart-line-main"><strong>{line.product.name}</strong><small>{formatClp(line.product.price)} × {line.quantity}</small></div>
                <div className="pos-qty-control">
                  <button type="button" onClick={() => updateQuantity(line.product, line.quantity - 1)}>−</button>
                  <input type="number" min="1" max={line.product.available} value={line.quantity} onChange={(event) => updateQuantity(line.product, Number(event.target.value))} aria-label={`Cantidad de ${line.product.name}`} />
                  <button type="button" disabled={line.quantity >= line.product.available} onClick={() => updateQuantity(line.product, line.quantity + 1)}>+</button>
                </div>
                <strong>{formatClp(line.product.price * line.quantity)}</strong>
              </div>
            ))}
          </div>

          <div className="pos-customer-grid">
            <label>Cliente registrado <small>(opcional)</small>
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">Cliente ocasional · no guardar datos personales</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}{customer.rut ? ` · ${customer.rut}` : ""}</option>
                ))}
              </select>
            </label>
            <div className="admin-inline-notice">
              {selectedCustomer ? (
                <><strong>{selectedCustomer.name}</strong>{selectedCustomer.rut ? ` · ${selectedCustomer.rut}` : ""}<br /><small>{selectedCustomer.email ?? selectedCustomer.phone ?? "Sin canal de contacto registrado"}</small></>
              ) : (
                <>No se almacenarán nombre, RUT, correo ni teléfono para esta venta.</>
              )}
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
            <label>Medio de pago
              <select name="paymentMethod" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="CASH">Efectivo</option>
                <option value="DEBIT_CARD">Tarjeta débito</option>
                <option value="CREDIT_CARD">Tarjeta crédito</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="OTHER">Otro</option>
              </select>
            </label>
            {paymentMethod === "CASH" && <label>Monto recibido<input name="amountReceived" type="number" min={total} step="1" value={amountReceived} onChange={(event) => setAmountReceived(event.target.value)} placeholder={String(total)} required /></label>}
          </div>

          {paymentMethod === "CASH" && <div className={`pos-change-box${cashInsufficient ? " is-warning" : ""}`}><span>Vuelto</span><strong>{formatClp(change)}</strong></div>}

          <button className="admin-button admin-button-primary pos-pay-button" type="submit" disabled={cart.length === 0 || total <= 0 || cashInsufficient}>Registrar venta</button>
          <small className="pos-sale-note">La venta queda asociada a {registerName}, al turno activo de {cashierName} y descuenta inventario de {warehouseName}.</small>
        </form>
      </div>
    </div>
  );
}
