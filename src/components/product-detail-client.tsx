"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useCart, type StoreProduct } from "@/components/cart-context";
import { formatClp } from "@/lib/format";
import { getProductImageUrl } from "@/lib/product-image";

export function ProductDetailClient({ product }: { product: StoreProduct }) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const maxQuantity = Math.min(25, product.stock);

  function handleAdd() {
    addItem(product, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <section className="container product-detail">
      <div className="product-detail-image">
        <Image
          src={getProductImageUrl(product.imageUrl, "detail")}
          alt={product.name}
          fill
          priority
          sizes="(max-width: 900px) calc(100vw - 40px), 560px"
          quality={94}
        />
      </div>
      <div className="product-detail-copy">
        <span className="eyebrow">{product.category}</span>
        <h1>{product.name}</h1>
        <p>{product.description}</p>
        <strong className="detail-price">{formatClp(product.price)} <small>/{product.unit === "KG" ? "kg" : "unidad"}</small></strong>
        <p className="stock-ok">✓ Disponible para compra online</p>
        <div className="detail-actions">
          <div className="quantity-control">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} disabled={quantity <= 1}>−</button>
            <span>{quantity}</span>
            <button type="button" onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))} disabled={quantity >= maxQuantity}>+</button>
          </div>
          <button type="button" className="button button-primary" onClick={handleAdd} disabled={product.stock <= 0}>{added ? "Agregado al carrito ✓" : "Agregar al carrito"}</button>
        </div>
        <ul className="trust-list"><li>Cadena de frío controlada</li><li>Precio y stock revalidados antes del pago</li><li>Pago Webpay temporalmente desactivado</li></ul>
        <Link href="/productos">← Volver a productos</Link>
      </div>
    </section>
  );
}
