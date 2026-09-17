"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/cart-context";
import { formatClp } from "@/lib/format";
import { calculateEstimatedShipping, FREE_SHIPPING_THRESHOLD } from "@/lib/pricing-config";
import { calculatePreviewDiscount, getPreviewCoupon, type PreviewCouponCode } from "@/lib/coupon-preview";
import { getProductImageUrl } from "@/lib/product-image";

export function CartPageClient() {
  const { items, subtotal, updateQuantity, removeItem, clearCart, hydrated } = useCart();
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<PreviewCouponCode | null>(null);
  const [couponMessage, setCouponMessage] = useState("");

  const shipping = calculateEstimatedShipping(subtotal);
  const discount = useMemo(() => calculatePreviewDiscount(subtotal, appliedCoupon ?? ""), [appliedCoupon, subtotal]);
  const total = Math.max(0, subtotal + shipping - discount);

  useEffect(() => {
    if (!appliedCoupon) return;
    const coupon = getPreviewCoupon(appliedCoupon);
    if (coupon && subtotal < coupon.minimumSubtotal) {
      setAppliedCoupon(null);
      setCouponMessage(`El cupón se retiró porque el subtotal bajó de ${formatClp(coupon.minimumSubtotal)}.`);
    }
  }, [appliedCoupon, subtotal]);

  function applyCoupon() {
    const coupon = getPreviewCoupon(couponInput);

    if (!coupon) {
      setAppliedCoupon(null);
      setCouponMessage("El código ingresado no es válido.");
      return;
    }
    if (subtotal < coupon.minimumSubtotal) {
      setAppliedCoupon(null);
      setCouponMessage(`Este cupón requiere un subtotal mínimo de ${formatClp(coupon.minimumSubtotal)}.`);
      return;
    }

    setAppliedCoupon(coupon.code);
    setCouponInput(coupon.code);
    setCouponMessage(`Cupón ${coupon.code} aplicado correctamente.`);
  }

  if (!hydrated) return <div className="container loading-state">Cargando carrito…</div>;
  if (items.length === 0) return (
    <div className="container empty-cart">
      <h2>Tu carrito está vacío</h2>
      <p>Agrega productos para comenzar tu pedido.</p>
      <Link href="/productos" className="button button-primary">Ver productos</Link>
    </div>
  );

  return (
    <section className="container cart-layout">
      <div className="cart-panel">
        <div className="cart-panel-heading">
          <div>
            <h2>Productos agregados</h2>
            <p>{items.length} {items.length === 1 ? "producto" : "productos"} en el carrito</p>
          </div>
          <button type="button" className="text-button" onClick={clearCart}>Vaciar carrito</button>
        </div>
        <div className="cart-table-head"><span>Producto</span><span>Precio</span><span>Cantidad</span><span>Subtotal</span><span /></div>
        {items.map(({ product, quantity }) => (
          <article className="cart-row" key={product.id}>
            <div className="cart-product">
              <Image
                src={getProductImageUrl(product.imageUrl, "thumb")}
                alt={product.name}
                width={224}
                height={172}
                sizes="(max-width: 620px) 86px, 112px"
                quality={88}
              />
              <div><h3>{product.name}</h3><p>{product.description}</p><small>{product.category}</small></div>
            </div>
            <strong>{formatClp(product.price)} <small>/{product.unit === "KG" ? "kg" : "un."}</small></strong>
            <div className="quantity-control" aria-label={`Cantidad de ${product.name}`}>
              <button type="button" onClick={() => updateQuantity(product.id, quantity - 1)} aria-label={`Disminuir ${product.name}`}>−</button>
              <span aria-live="polite">{quantity}</span>
              <button type="button" onClick={() => updateQuantity(product.id, quantity + 1)} disabled={quantity >= Math.min(25, product.stock)} aria-label={`Aumentar ${product.name}`}>+</button>
            </div>
            <strong>{formatClp(product.price * quantity)}</strong>
            <button type="button" className="remove-button" onClick={() => removeItem(product.id)} aria-label={`Eliminar ${product.name}`}>×</button>
          </article>
        ))}
        <div className="cart-tools">
          <div className="coupon-control">
            <label htmlFor="coupon">Código de descuento</label>
            <div>
              <input id="coupon" value={couponInput} onChange={(event) => setCouponInput(event.target.value.toUpperCase())} placeholder="BIENVENIDA5" maxLength={30} />
              <button type="button" className="button button-light" onClick={applyCoupon}>Aplicar</button>
            </div>
            {couponMessage && <p className={appliedCoupon ? "coupon-message success" : "coupon-message error"} role="status">{couponMessage}</p>}
          </div>
          <p>El descuento se muestra como referencia. Renacer Distribuidora confirmará descuento y total final antes de enviarte el link de pago.</p>
        </div>
      </div>
      <aside className="order-summary">
        <h2>Resumen del pedido</h2>
        <div><span>Subtotal</span><strong>{formatClp(subtotal)}</strong></div>
        <div><span>Despacho estimado</span><strong>{shipping === 0 ? "Gratis" : formatClp(shipping)}</strong></div>
        {shipping > 0 && <p className="shipping-hint">Despacho gratis desde {formatClp(FREE_SHIPPING_THRESHOLD)}.</p>}
        {discount > 0 && <div className="discount-row"><span>Descuento {appliedCoupon}</span><strong>−{formatClp(discount)}</strong></div>}
        <div className="summary-total"><span>Total estimado</span><strong>{formatClp(total)}</strong></div>
        <Link href={`/checkout${appliedCoupon ? `?coupon=${encodeURIComponent(appliedCoupon)}` : ""}`} className="button button-primary full">Continuar con datos de entrega →</Link>
        <Link href="/productos" className="button button-light full">Seguir comprando</Link>
        <ul className="trust-list"><li>❄ Cadena de frío controlada</li><li>✓ Cantidades guardadas en este dispositivo</li><li>✓ Confirmación y link de pago enviados por WhatsApp</li></ul>
      </aside>
    </section>
  );
}
