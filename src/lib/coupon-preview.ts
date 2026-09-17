export const PREVIEW_COUPONS = {
  BIENVENIDA5: { percent: 5, minimumSubtotal: 30_000 },
} as const;

export type PreviewCouponCode = keyof typeof PREVIEW_COUPONS;

export function getPreviewCoupon(code: string) {
  const normalized = code.trim().toUpperCase() as PreviewCouponCode;
  const rule = PREVIEW_COUPONS[normalized];
  return rule ? { code: normalized, ...rule } : null;
}

export function calculatePreviewDiscount(subtotal: number, code: string): number {
  const coupon = getPreviewCoupon(code);
  if (!coupon || subtotal < coupon.minimumSubtotal) return 0;
  return Math.floor((subtotal * coupon.percent) / 100);
}
