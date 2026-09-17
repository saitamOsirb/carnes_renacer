import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { ClearCartOnPaid } from "@/components/clear-cart-on-paid";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Resultado del pago", robots: { index: false, follow: false } };

export default async function PaymentResultPage({ searchParams }: { searchParams: Promise<{ order?: string; result?: string }> }) {
  const { order: orderNumber, result } = await searchParams;
  const order = orderNumber ? await prisma.order.findUnique({ where: { orderNumber } }) : null;
  const paid = order?.status === OrderStatus.PAID;
  const pending = result === "pending-review";

  return <section className="result-page container">
    {paid && <ClearCartOnPaid />}
    <div className={`result-card ${paid ? "success" : pending ? "pending" : "failure"}`}>
      <div className="result-icon">{paid ? "✓" : pending ? "…" : "!"}</div>
      <h1>{paid ? "Pago confirmado" : pending ? "Pago en revisión" : result === "cancelled" ? "Pago cancelado" : "Pago no completado"}</h1>
      <p>{paid ? "Recibimos tu pago y comenzaremos a preparar el pedido." : pending ? "No repitas el pago. Revisaremos la transacción antes de confirmar el pedido." : "No se realizó ningún cobro confirmado. Puedes volver al carrito e intentarlo nuevamente."}</p>
      {order && <div className="result-data"><div><span>Número de orden</span><strong>{order.orderNumber}</strong></div><div><span>Total</span><strong>{formatClp(order.total)}</strong></div>{paid && <div><span>Autorización</span><strong>{order.authorizationCode ?? "Confirmada"}</strong></div>}</div>}
      <div className="result-actions"><Link href={paid ? "/productos" : "/carrito"} className="button button-primary">{paid ? "Seguir comprando" : "Volver al carrito"}</Link><Link href="/contacto" className="button button-light">Contactar soporte</Link></div>
    </div>
  </section>;
}
