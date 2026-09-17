"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/cart-context";
import { getCsrfToken } from "@/lib/client-security";
import { formatClp } from "@/lib/format";
import { calculateEstimatedShipping, FREE_SHIPPING_THRESHOLD } from "@/lib/pricing-config";
import { calculatePreviewDiscount } from "@/lib/coupon-preview";

const DRAFT_KEY = "renacer_checkout_draft_v1";
const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";

type CheckoutDraft = {
  name: string;
  email: string;
  phone: string;
  rut: string;
  addressLine: string;
  addressDetail: string;
  deliveryDate: string;
  notes: string;
  termsAccepted: boolean;
};

const emptyDraft: CheckoutDraft = {
  name: "",
  email: "",
  phone: "",
  rut: "",
  addressLine: "",
  addressDetail: "",
  deliveryDate: "",
  notes: "",
  termsAccepted: false,
};

function nextBusinessDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function readDraft(): CheckoutDraft {
  try {
    const saved = window.localStorage.getItem(DRAFT_KEY);
    if (!saved) return emptyDraft;
    const parsed = JSON.parse(saved) as Partial<CheckoutDraft>;
    return {
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 120) : "",
      email: typeof parsed.email === "string" ? parsed.email.slice(0, 160) : "",
      phone: typeof parsed.phone === "string" ? parsed.phone.slice(0, 18) : "",
      rut: typeof parsed.rut === "string" ? parsed.rut.slice(0, 20) : "",
      addressLine: typeof parsed.addressLine === "string" ? parsed.addressLine.slice(0, 180) : "",
      addressDetail: typeof parsed.addressDetail === "string" ? parsed.addressDetail.slice(0, 100) : "",
      deliveryDate: typeof parsed.deliveryDate === "string" ? parsed.deliveryDate.slice(0, 10) : "",
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 250) : "",
      termsAccepted: parsed.termsAccepted === true,
    };
  } catch {
    return emptyDraft;
  }
}

function makeIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `renacer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CheckoutForm() {
  const searchParams = useSearchParams();
  const { items, subtotal, hydrated } = useCart();
  const [draft, setDraft] = useState<CheckoutDraft>(emptyDraft);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef("");
  const coupon = (searchParams.get("coupon") ?? "").toUpperCase();
  const estimatedShipping = calculateEstimatedShipping(subtotal);
  const previewDiscount = calculatePreviewDiscount(subtotal, coupon);
  const estimatedTotal = Math.max(0, subtotal + estimatedShipping - previewDiscount);
  const minDate = useMemo(nextBusinessDate, []);

  useEffect(() => {
    setDraft(readDraft());
    idempotencyKey.current = makeIdempotencyKey();
    setDraftLoaded(true);
  }, []);

  function updateField<K extends keyof CheckoutDraft>(field: K, value: CheckoutDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
    setError("");
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setSaved(true);
      return true;
    } catch {
      setError("No pudimos guardar los datos en este navegador. Revisa los permisos de almacenamiento.");
      return false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!items.length) return;

    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter instanceof HTMLButtonElement ? nativeEvent.submitter : null;
    const intent = submitter?.value ?? "save";

    if (!saveDraft() || intent !== "payment" || !PAYMENTS_ENABLED) return;

    setSubmitting(true);
    setError("");
    if (!idempotencyKey.current) idempotencyKey.current = makeIdempotencyKey();

    const payload = {
      items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      couponCode: coupon,
      customer: {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        rut: draft.rut,
        addressLine: draft.addressLine,
        addressDetail: draft.addressDetail,
        commune: "Antofagasta",
        region: "Región de Antofagasta",
        deliveryDate: draft.deliveryDate,
        notes: draft.notes,
        termsAccepted: draft.termsAccepted,
      },
    };

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": getCsrfToken(),
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos iniciar el pago.");

      const paymentForm = document.createElement("form");
      paymentForm.method = "POST";
      paymentForm.action = result.url;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "token_ws";
      input.value = result.token;
      paymentForm.appendChild(input);
      document.body.appendChild(paymentForm);
      paymentForm.submit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos iniciar el pago.");
      idempotencyKey.current = makeIdempotencyKey();
      setSubmitting(false);
    }
  }

  if (!hydrated || !draftLoaded) return <div className="container loading-state">Cargando checkout…</div>;
  if (!items.length) return <div className="container empty-cart"><h2>No hay productos para continuar</h2><Link href="/productos" className="button button-primary">Ver productos</Link></div>;

  return (
    <section className="container checkout-layout">
      <form className="checkout-form" onSubmit={handleSubmit}>
        <h2>Datos de entrega</h2>
        <p className="section-help">Puedes completar y guardar tus datos. El pago se habilitará cuando termine la integración de Webpay Plus.</p>
        <div className="form-grid">
          <label>Nombre completo<input name="name" required minLength={3} maxLength={120} autoComplete="name" value={draft.name} onChange={(event) => updateField("name", event.target.value)} /></label>
          <label>Email<input name="email" type="email" required maxLength={160} autoComplete="email" value={draft.email} onChange={(event) => updateField("email", event.target.value)} /></label>
          <label>Teléfono<input name="phone" required pattern="\+?[0-9\s-]{8,18}" autoComplete="tel" placeholder="+56 9 1234 5678" value={draft.phone} onChange={(event) => updateField("phone", event.target.value)} /></label>
          <label>RUT (opcional)<input name="rut" maxLength={20} placeholder="12.345.678-5" value={draft.rut} onChange={(event) => updateField("rut", event.target.value)} /></label>
          <label className="span-2">Dirección<input name="addressLine" required minLength={5} maxLength={180} autoComplete="street-address" value={draft.addressLine} onChange={(event) => updateField("addressLine", event.target.value)} /></label>
          <label>Depto./oficina (opcional)<input name="addressDetail" maxLength={100} value={draft.addressDetail} onChange={(event) => updateField("addressDetail", event.target.value)} /></label>
          <label>Comuna<select name="commune" defaultValue="Antofagasta"><option>Antofagasta</option></select></label>
          <label>Fecha preferida<input name="deliveryDate" type="date" min={minDate} value={draft.deliveryDate} onChange={(event) => updateField("deliveryDate", event.target.value)} /></label>
          <label className="span-2">Instrucciones especiales<textarea name="notes" maxLength={250} rows={4} placeholder="Horario, referencias de acceso o indicaciones." value={draft.notes} onChange={(event) => updateField("notes", event.target.value)} /></label>
        </div>
        <label className="terms-check"><input type="checkbox" name="termsAccepted" required checked={draft.termsAccepted} onChange={(event) => updateField("termsAccepted", event.target.checked)} /> Acepto los <Link href="/terminos" target="_blank">términos y condiciones</Link> y la <Link href="/privacidad" target="_blank">política de privacidad</Link>.</label>
        {saved && <div className="success-box" role="status">Datos de entrega guardados correctamente en este dispositivo.</div>}
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="button button-light full" type="submit" name="intent" value="save">Guardar datos de entrega</button>
        <button className={PAYMENTS_ENABLED ? "button button-primary full" : "button button-primary full payment-disabled"} type="submit" name="intent" value="payment" disabled={!PAYMENTS_ENABLED || submitting} aria-disabled={!PAYMENTS_ENABLED || submitting}>
          {submitting ? "Conectando con Webpay…" : PAYMENTS_ENABLED ? "Pagar con Webpay Plus" : "Pago Webpay Plus en integración"}
        </button>
        {!PAYMENTS_ENABLED && <p className="payment-disabled-note">Este es el único paso desactivado. El carrito, las cantidades, el cupón y los datos de entrega permanecen operativos.</p>}
      </form>
      <aside className="order-summary checkout-summary">
        <h2>Tu pedido</h2>
        {items.map((item) => <div key={item.product.id}><span>{item.product.name} × {item.quantity}</span><strong>{formatClp(item.product.price * item.quantity)}</strong></div>)}
        <hr />
        <div><span>Subtotal</span><strong>{formatClp(subtotal)}</strong></div>
        <div><span>Despacho estimado</span><strong>{estimatedShipping === 0 ? "Gratis" : formatClp(estimatedShipping)}</strong></div>
        {coupon && <div><span>Cupón</span><strong>{coupon}</strong></div>}
        {previewDiscount > 0 && <div className="discount-row"><span>Descuento estimado</span><strong>−{formatClp(previewDiscount)}</strong></div>}
        <div className="summary-total"><span>Total estimado</span><strong>{formatClp(estimatedTotal)}</strong></div>
        <p className="summary-note">Los precios, el stock, el despacho y los descuentos se recalcularán en el servidor antes de habilitar el pago.</p>
      </aside>
    </section>
  );
}
