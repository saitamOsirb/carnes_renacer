import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { finalizePaidOrder, releaseOrderReservation } from "@/lib/order-service";
import { prisma } from "@/lib/prisma";
import { commitWebpayTransaction } from "@/lib/webpay";
import { sendPaidOrderNotifications } from "@/lib/mailer";

export const runtime = "nodejs";

function resultUrl(orderNumber: string | undefined, result: string): URL {
  const base = getServerEnv().APP_URL;
  const url = new URL("/pago/resultado", base);
  if (orderNumber) url.searchParams.set("order", orderNumber);
  url.searchParams.set("result", result);
  return url;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const token = formData.get("token_ws")?.toString();
  const cancelledToken = formData.get("TBK_TOKEN")?.toString();
  const cancelledBuyOrder = formData.get("TBK_ORDEN_COMPRA")?.toString();

  if (!token && cancelledToken && cancelledBuyOrder) {
    const order = await prisma.order.findUnique({ where: { buyOrder: cancelledBuyOrder } });
    if (order) await releaseOrderReservation(order.id, OrderStatus.CANCELLED, PaymentStatus.CANCELLED);
    return NextResponse.redirect(resultUrl(order?.orderNumber, "cancelled"), 303);
  }

  if (!token || token.length > 128) {
    return NextResponse.redirect(resultUrl(undefined, "invalid"), 303);
  }

  const order = await prisma.order.findUnique({ where: { tokenWs: token } });
  if (!order) return NextResponse.redirect(resultUrl(undefined, "not-found"), 303);
  if (order.status === OrderStatus.PAID) return NextResponse.redirect(resultUrl(order.orderNumber, "authorized"), 303);

  try {
    const commit = await commitWebpayTransaction(token);
    const paymentAuthorized = commit.response_code === 0 && commit.status === "AUTHORIZED";
    const exactMatch =
      commit.buy_order === order.buyOrder &&
      commit.session_id === order.sessionId &&
      commit.amount === order.total;

    if (paymentAuthorized && !exactMatch) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAYMENT_REVIEW,
          paymentStatus: PaymentStatus.REVIEW,
          webpayResponse: JSON.parse(JSON.stringify(commit)),
        },
      });
      return NextResponse.redirect(resultUrl(order.orderNumber, "pending-review"), 303);
    }

    if (!paymentAuthorized) {
      await releaseOrderReservation(order.id, OrderStatus.PAYMENT_FAILED, PaymentStatus.REJECTED);
      await prisma.order.update({ where: { id: order.id }, data: { webpayResponse: JSON.parse(JSON.stringify(commit)) } });
      return NextResponse.redirect(resultUrl(order.orderNumber, "rejected"), 303);
    }

    const paidOrder = await finalizePaidOrder(order.id, {
      authorizationCode: commit.authorization_code,
      paymentTypeCode: commit.payment_type_code,
      installmentsNumber: commit.installments_number,
      cardLastFour: commit.card_detail?.card_number,
      response: JSON.parse(JSON.stringify(commit)),
    });
    await sendPaidOrderNotifications(paidOrder).catch((error) => console.error("Correo de pago", error));
    return NextResponse.redirect(resultUrl(order.orderNumber, "authorized"), 303);
  } catch (error) {
    console.error("Error confirmando Webpay", error);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAYMENT_REVIEW, paymentStatus: PaymentStatus.REVIEW },
    }).catch((updateError) => console.error("No se pudo marcar revisión", updateError));
    return NextResponse.redirect(resultUrl(order.orderNumber, "pending-review"), 303);
  }
}
