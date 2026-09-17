import { checkoutSchema } from "@/lib/checkout-schema";
import { getServerEnv } from "@/lib/env";
import { createPendingOrder, attachWebpayToken, expireOldReservations, releaseOrderReservation } from "@/lib/order-service";
import { createWebpayTransaction } from "@/lib/webpay";
import { assertCsrf, assertJsonRequest, assertTrustedOrigin, enforceRateLimit, errorResponse, getClientIp, hashIdentifier, HttpError } from "@/lib/security";
import { OrderStatus, PaymentStatus, Prisma, type Order } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.PAYMENTS_ENABLED !== "true") {
    return errorResponse(new HttpError(503, "El pago con Webpay Plus está temporalmente desactivado mientras finaliza la integración.", "PAYMENTS_DISABLED"));
  }
  let order: Order | undefined;
  let idempotencyKey: string | undefined;
  try {
    assertJsonRequest(request);
    assertTrustedOrigin(request);
    assertCsrf(request);
    const ipKey = hashIdentifier(getClientIp(request));
    await enforceRateLimit(`checkout:${ipKey}`, 8, 10 * 60_000);

    idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
    if (!idempotencyKey || !/^[a-zA-Z0-9-]{16,100}$/.test(idempotencyKey)) {
      throw new HttpError(400, "Clave de idempotencia inválida.", "INVALID_IDEMPOTENCY_KEY");
    }

    const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.status === OrderStatus.PENDING_PAYMENT && existing.tokenWs && existing.webpayUrl) {
        return Response.json(
          { ok: true, token: existing.tokenWs, url: existing.webpayUrl, orderNumber: existing.orderNumber },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw new HttpError(409, "La solicitud de pago ya fue procesada. Actualiza el estado antes de reintentar.", "IDEMPOTENCY_CONFLICT");
    }

    const body = await request.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Datos de compra inválidos.";
      throw new HttpError(422, message, "VALIDATION_ERROR");
    }

    await expireOldReservations().catch((error) => console.error("No se pudieron expirar reservas", error));
    order = await createPendingOrder(parsed.data, idempotencyKey);
    const env = getServerEnv();
    const transaction = await createWebpayTransaction({
      buyOrder: order.buyOrder,
      sessionId: order.sessionId,
      amount: order.total,
      returnUrl: `${env.APP_URL}/api/webpay/return`,
    });
    await attachWebpayToken(order.id, transaction.token, transaction.url);

    return Response.json(
      { ok: true, token: transaction.token, url: transaction.url, orderNumber: order.orderNumber },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!order && idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
      if (existing?.tokenWs && existing.webpayUrl && existing.status === OrderStatus.PENDING_PAYMENT) {
        return Response.json(
          { ok: true, token: existing.tokenWs, url: existing.webpayUrl, orderNumber: existing.orderNumber },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
      return errorResponse(new HttpError(409, "La solicitud ya está siendo procesada. Intenta nuevamente en unos segundos.", "IDEMPOTENCY_IN_PROGRESS"));
    }
    if (order) {
      await releaseOrderReservation(order.id, OrderStatus.PAYMENT_FAILED, PaymentStatus.FAILED).catch((releaseError) => console.error("No se pudo liberar reserva", releaseError));
    }
    return errorResponse(error);
  }
}
