import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { CartPageClient } from "@/components/cart-page-client";
export const metadata: Metadata = { title: "Carrito" };
export default function CartPage() { return <><PageHero eyebrow="Inicio / Carrito" title="Tu carrito de compras" subtitle="Revisa tus productos antes de continuar con el pedido." image="/images/hero/cart.jpg" /><div className="checkout-steps container"><strong>1 Carrito</strong><span>2 Datos de entrega</span><span>3 Pago</span><span>4 Confirmación</span></div><CartPageClient /></>; }
