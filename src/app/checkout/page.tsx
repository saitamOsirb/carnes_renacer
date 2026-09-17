import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = { title: "Datos de entrega", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <>
      <div className="checkout-header"><div className="container"><span className="eyebrow">Compra asistida</span><h1>Datos de entrega</h1><p>Completa tus datos y envía el pedido por WhatsApp. Confirmaremos stock y total final antes de enviarte el link de pago.</p></div></div>
      <div className="checkout-steps container"><span>1 Carrito</span><strong>2 Datos de entrega</strong><span>3 Solicitud por WhatsApp</span><span>4 Link de pago</span></div>
      <Suspense fallback={<div className="container loading-state">Cargando…</div>}><CheckoutForm /></Suspense>
    </>
  );
}
