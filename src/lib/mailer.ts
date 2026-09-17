import "server-only";

import type { Order } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { formatClp } from "@/lib/format";

export async function sendPaidOrderNotifications(order: Order): Promise<void> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY || !env.ORDER_FROM_EMAIL) return;

  const recipients = [order.customerEmail, env.ORDER_NOTIFICATION_EMAIL].filter(Boolean) as string[];
  if (!recipients.length) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.ORDER_FROM_EMAIL,
      to: recipients,
      subject: `Pago confirmado ${order.orderNumber}`,
      html: `<h1>Pago confirmado</h1><p>Orden <strong>${order.orderNumber}</strong></p><p>Total: <strong>${formatClp(order.total)}</strong></p><p>Coordinaremos el despacho con los datos registrados.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) console.error("No se pudo enviar el correo de confirmación", await response.text());
}
