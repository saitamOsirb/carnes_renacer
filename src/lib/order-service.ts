import "server-only";

import { randomUUID } from "node:crypto";
import { OrderStatus, PaymentStatus, Prisma, type Order } from "@prisma/client";
import type { CheckoutInput } from "@/lib/checkout-schema";
import { prisma } from "@/lib/prisma";
import { calculateDiscount, calculateLineSubtotal, calculateShipping } from "@/lib/pricing";
import { HttpError } from "@/lib/security";
import { formatRut } from "@/lib/rut";

const RESERVATION_MINUTES = 15;

function makeBuyOrder(): string {
  return `REN${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 8)}`.slice(0, 26);
}

function makeOrderNumber(): string {
  return `R-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

export async function createPendingOrder(input: CheckoutInput, idempotencyKey: string): Promise<Order> {
  const uniqueIds = [...new Set(input.items.map((item) => item.productId))];
  if (uniqueIds.length !== input.items.length) {
    throw new HttpError(422, "Hay productos repetidos en el carrito.", "DUPLICATE_CART_ITEMS");
  }

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: uniqueIds }, active: true },
    });

    if (products.length !== uniqueIds.length) {
      throw new HttpError(422, "Uno o más productos ya no están disponibles.", "PRODUCT_UNAVAILABLE");
    }

    const productMap = new Map(products.map((product) => [product.id, product]));
    const lines = input.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new HttpError(422, "Producto inválido.", "INVALID_PRODUCT");
      return {
        product,
        quantity: item.quantity,
        subtotal: calculateLineSubtotal(product, item.quantity),
      };
    });

    for (const line of lines) {
      const reserved = await tx.product.updateMany({
        where: {
          id: line.product.id,
          active: true,
          stock: { gte: line.quantity },
        },
        data: {
          stock: { decrement: line.quantity },
          reserved: { increment: line.quantity },
        },
      });
      if (reserved.count !== 1) {
        throw new HttpError(409, `Stock insuficiente para ${line.product.name}.`, "INSUFFICIENT_STOCK");
      }
    }

    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const couponCode = input.couponCode || undefined;
    const coupon = couponCode
      ? await tx.coupon.findUnique({ where: { code: couponCode } })
      : null;
    if (couponCode && !coupon) throw new HttpError(422, "Cupón no válido.", "INVALID_COUPON");

    const discount = calculateDiscount(subtotal, coupon);
    const shipping = calculateShipping(subtotal - discount, input.customer.commune);
    const total = subtotal - discount + shipping;
    if (total <= 0 || total > 999999999) {
      throw new HttpError(422, "Total de compra inválido.", "INVALID_TOTAL");
    }

    const reservationExpires = new Date(Date.now() + RESERVATION_MINUTES * 60_000);
    return tx.order.create({
      data: {
        orderNumber: makeOrderNumber(),
        buyOrder: makeBuyOrder(),
        idempotencyKey,
        sessionId: randomUUID().slice(0, 61),
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        customerPhone: input.customer.phone,
        customerRut: input.customer.rut ? formatRut(input.customer.rut) : null,
        addressLine: input.customer.addressLine,
        addressDetail: input.customer.addressDetail || null,
        commune: input.customer.commune,
        region: input.customer.region,
        deliveryDate: input.customer.deliveryDate ? new Date(`${input.customer.deliveryDate}T12:00:00-04:00`) : null,
        notes: input.customer.notes || null,
        subtotal,
        shipping,
        discount,
        couponCode: coupon?.code ?? null,
        total,
        reservationExpires,
        items: {
          create: lines.map(({ product, quantity, subtotal: lineSubtotal }) => ({
            productId: product.id,
            productName: product.name,
            imageUrl: product.imageUrl,
            unit: product.unit,
            quantity,
            unitPrice: product.price,
            subtotal: lineSubtotal,
          })),
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function attachWebpayToken(orderId: string, token: string, webpayUrl: string): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { tokenWs: token, webpayUrl } });
}

export async function releaseOrderReservation(
  orderId: string,
  status: OrderStatus = OrderStatus.CANCELLED,
  paymentStatus: PaymentStatus = PaymentStatus.CANCELLED,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status !== OrderStatus.PENDING_PAYMENT) return;

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: { increment: item.quantity },
          reserved: { decrement: item.quantity },
        },
      });
    }

    await tx.order.update({ where: { id: order.id }, data: { status, paymentStatus } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type PaymentConfirmation = {
  authorizationCode?: string;
  paymentTypeCode?: string;
  installmentsNumber?: number;
  cardLastFour?: string;
  response: Prisma.InputJsonValue;
};

export async function finalizePaidOrder(orderId: string, confirmation: PaymentConfirmation): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new HttpError(404, "Orden no encontrada.", "ORDER_NOT_FOUND");
    if (order.status === OrderStatus.PAID) return order;
    if (order.status !== OrderStatus.PENDING_PAYMENT && order.status !== OrderStatus.PAYMENT_REVIEW) {
      throw new HttpError(409, "La orden no puede confirmarse en su estado actual.", "ORDER_NOT_PAYABLE");
    }

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { reserved: { decrement: item.quantity } },
      });
    }

    if (order.couponCode) {
      await tx.coupon.updateMany({
        where: { code: order.couponCode, active: true },
        data: { usedCount: { increment: 1 } },
      });
    }

    return tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        paymentStatus: PaymentStatus.AUTHORIZED,
        authorizationCode: confirmation.authorizationCode,
        paymentTypeCode: confirmation.paymentTypeCode,
        installmentsNumber: confirmation.installmentsNumber,
        cardLastFour: confirmation.cardLastFour,
        webpayResponse: confirmation.response,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function expireOldReservations(): Promise<number> {
  const expired = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT, reservationExpires: { lt: new Date() } },
    select: { id: true },
    take: 100,
  });
  for (const order of expired) await releaseOrderReservation(order.id, OrderStatus.CANCELLED, PaymentStatus.CANCELLED);
  return expired.length;
}
