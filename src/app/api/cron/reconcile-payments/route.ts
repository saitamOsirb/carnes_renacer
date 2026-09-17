import { OrderStatus, PaymentStatus } from "@prisma/client";
import { finalizePaidOrder } from "@/lib/order-service";
import { prisma } from "@/lib/prisma";
import { getWebpayTransactionStatus } from "@/lib/webpay";
import { sendPaidOrderNotifications } from "@/lib/mailer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const reviewOrders = await prisma.order.findMany({
    where: { status: OrderStatus.PAYMENT_REVIEW, tokenWs: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let authorized = 0;
  let stillPending = 0;
  for (const order of reviewOrders) {
    try {
      const status = await getWebpayTransactionStatus(order.tokenWs!);
      const exactMatch = status.buy_order === order.buyOrder && status.session_id === order.sessionId && status.amount === order.total;
      if (status.response_code === 0 && status.status === "AUTHORIZED" && exactMatch) {
        const paid = await finalizePaidOrder(order.id, {
          authorizationCode: status.authorization_code,
          paymentTypeCode: status.payment_type_code,
          installmentsNumber: status.installments_number,
          cardLastFour: status.card_detail?.card_number,
          response: JSON.parse(JSON.stringify(status)),
        });
        await sendPaidOrderNotifications(paid).catch((error) => console.error("Correo de conciliación", error));
        authorized += 1;
      } else {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.REVIEW, webpayResponse: JSON.parse(JSON.stringify(status)) },
        });
        stillPending += 1;
      }
    } catch (error) {
      console.error(`Conciliación fallida para ${order.orderNumber}`, error);
      stillPending += 1;
    }
  }

  return Response.json({ ok: true, checked: reviewOrders.length, authorized, stillPending });
}
