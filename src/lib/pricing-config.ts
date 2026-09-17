/**
 * Valores públicos usados para mostrar estimaciones en carrito y checkout.
 *
 * Este módulo es deliberadamente independiente de Prisma y de cualquier API
 * exclusiva del servidor, por lo que puede importarse con seguridad desde
 * componentes `"use client"`.
 */
export const FREE_SHIPPING_THRESHOLD = 80_000;
export const STANDARD_SHIPPING = 4_990;

export function calculateEstimatedShipping(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING;
}
