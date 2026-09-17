import "server-only";

import type { Coupon, Product } from "@prisma/client";
import { HttpError } from "@/lib/security";
import { FREE_SHIPPING_THRESHOLD, STANDARD_SHIPPING } from "@/lib/pricing-config";

export function calculateShipping(subtotal: number, commune: string): number {
  if (commune !== "Antofagasta") {
    throw new HttpError(422, "La comuna seleccionada está fuera de cobertura.", "OUTSIDE_COVERAGE");
  }
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING;
}

export function calculateDiscount(subtotal: number, coupon: Coupon | null): number {
  if (!coupon) return 0;
  const now = new Date();
  if (!coupon.active) throw new HttpError(422, "El cupón no está activo.", "COUPON_INACTIVE");
  if (coupon.startsAt && coupon.startsAt > now) throw new HttpError(422, "El cupón aún no está vigente.", "COUPON_NOT_STARTED");
  if (coupon.endsAt && coupon.endsAt < now) throw new HttpError(422, "El cupón está vencido.", "COUPON_EXPIRED");
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw new HttpError(422, "El cupón alcanzó su límite de uso.", "COUPON_LIMIT_REACHED");
  }
  if (subtotal < coupon.minimumSubtotal) {
    throw new HttpError(422, `El cupón exige un subtotal mínimo de $${coupon.minimumSubtotal.toLocaleString("es-CL")}.`, "COUPON_MINIMUM_NOT_MET");
  }

  const percent = coupon.percentOff ? Math.floor((subtotal * coupon.percentOff) / 100) : 0;
  const fixed = coupon.fixedAmountOff ?? 0;
  return Math.min(subtotal, Math.max(percent, fixed));
}

export function calculateLineSubtotal(product: Pick<Product, "price">, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new HttpError(422, "Cantidad de producto inválida.", "INVALID_QUANTITY");
  }
  return product.price * quantity;
}
