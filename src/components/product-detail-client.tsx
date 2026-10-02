"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useCart, type StoreProduct } from "@/components/cart-context";
import { formatClp } from "@/lib/format";
import { formatQuantity, normalizeQuantity, roundQuantity } from "@/lib/quantity";
import { getProductImageUrl } from "@/lib/product-image";

export function ProductDetailClient({ product }: { product: StoreProduct }) {
  const initial = normalizeQuantity(Math.min(1, product.stock), product.unit, Math.min(25, product.stock));
  const [quantity, setQuantity] = useState(initial);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const maxQuantity = Math.min(25, product.stock);
  const quickStep = product.unit === "KG" ? 0.1 : 1;
  const inputStep = product.unit === "KG" ? "0.001" : "1";
  const minimum = product.unit === "KG" ? 0.001 : 1;

  function updateQuantity(value: number) {
    const normalized = normalizeQuantity(value, product.unit, maxQuantity);
    if (normalized > 0) setQuantity(normalized);
  }

  function handleAdd() {
    if (quantity <= 0) return;
    addItem(product, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <section className="container product-detail">
      <div className="product-detail-image"><Image src={getProductImageUrl(product.imageUrl, "detail")} alt={product.name} fill priority sizes="(max-width: 900px) calc(100vw - 40px), 560px" quality={94} /></div>
      <div className="product-detail-copy">
        <span className="eyebrow">{product.category}</span><h1>{product.name}</h1><p>{product.description}</p>
        <strong className="detail-price">{formatClp(product.price)} <small>/{product.unit === "KG" ? "kg" : "unidad"}</small></strong>
        <p className="stock-ok">✓ Disponible: {formatQuantity(product.stock, product.unit)}</p>
        <div className="detail-actions">
          <div className="quantity-control">
            <button type="button" onClick={() => updateQuantity(roundQuantity(quantity - quickStep))} disabled={quantity <= minimum}>−</button>
            <input type="number" min={minimum} max={maxQuantity} step={inputStep} value={quantity} onChange={(event) => updateQuantity(Number(event.target.value))} aria-label={product.unit === "KG" ? `Peso en kg de ${product.name}` : `Cantidad de ${product.name}`} />
            <button type="button" onClick={() => updateQuantity(roundQuantity(quantity + quickStep))} disabled={quantity >= maxQuantity}>+</button>
          </div>
          <button type="button" className="button button-primary" onClick={handleAdd} disabled={product.stock <= 0 || quantity <= 0}>{added ? "Agregado al carrito ✓" : `Agregar ${formatQuantity(quantity, product.unit)}`}</button>
        </div>
        <ul className="trust-list"><li>Cadena de frío controlada</li><li>Productos por kg con precisión de 1 gramo</li><li>Precio y stock revalidados antes del pago</li></ul>
        <Link href="/productos">← Volver a productos</Link>
      </div>
    </section>
  );
}
