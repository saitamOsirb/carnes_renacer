import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = { title: "Datos de entrega", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <>
      <div className="checkout-header"><div className="container"><span className="eyebrow">Compra segura</span><h1>Datos de entrega</h1><p>Completa y guarda tus datos. El botón de pago permanecerá desactivado hasta finalizar Webpay Plus.</p></div></div>
      <div className="checkout-steps container"><span>1 Carrito</span><strong>2 Datos de entrega</strong><span className="step-disabled">3 Pago pendiente</span><span>4 Confirmación</span></div>
      <Suspense fallback={<div className="container loading-state">Cargando…</div>}><CheckoutForm /></Suspense>
    </>
  );
}
