"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { StoreProduct } from "@/components/cart-context";
import { useCart } from "@/components/cart-context";
import { formatClp } from "@/lib/format";
import { getProductImageUrl } from "@/lib/product-image";

function CartIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l1.7 10.1a2 2 0 0 0 2 1.7h7.8a2 2 0 0 0 2-1.6L20 7H6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="19" r="1.3" fill="currentColor"/><circle cx="17" cy="19" r="1.3" fill="currentColor"/></svg>;
}

export function ProductCard({ product }: { product: StoreProduct }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  function handleAdd() {
    addItem(product);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1200);
  }

  return (
    <article className="product-card">
      <Link href={`/productos/${product.slug}`} className="product-image-wrap" prefetch={false}>
        {product.featured && <span className="product-tag">Top ventas</span>}
        <Image
          src={getProductImageUrl(product.imageUrl, "card")}
          alt={product.name}
          fill
          sizes="(max-width: 620px) calc(50vw - 18px), (max-width: 860px) calc(33vw - 20px), (max-width: 1180px) calc(25vw - 20px), 280px"
          quality={90}
          loading="lazy"
          decoding="async"
          className="product-image"
        />
      </Link>
      <div className="product-card-body">
        <span className="eyebrow-small">{product.category}</span>
        <h3><Link href={`/productos/${product.slug}`} prefetch={false}>{product.name}</Link></h3>
        <p>{product.description}</p>
        <div className="product-card-footer">
          <strong>{formatClp(product.price)} <small>/{product.unit === "KG" ? "kg" : "unidad"}</small></strong>
          <button type="button" className={`icon-button${added ? " added" : ""}`} onClick={handleAdd} disabled={product.stock <= 0} aria-label={`Agregar ${product.name} al carrito`}>
            {added ? "✓" : <CartIcon />}
          </button>
        </div>
      </div>
    </article>
  );
}
