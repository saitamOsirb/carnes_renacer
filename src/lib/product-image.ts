export type ProductImageVariant = "thumb" | "card" | "detail";

const PRODUCT_IMAGE_PREFIX = "/images/products/";

/**
 * Resolves the pre-optimized product image intended for the current UI context.
 * External or unexpected URLs are returned unchanged instead of being rewritten.
 */
export function getProductImageUrl(
  imageUrl: string,
  variant: ProductImageVariant,
): string {
  if (!imageUrl.startsWith(PRODUCT_IMAGE_PREFIX)) return imageUrl;

  const fileName = imageUrl.slice(PRODUCT_IMAGE_PREFIX.length);
  if (!fileName || fileName.includes("/")) return imageUrl;

  return `${PRODUCT_IMAGE_PREFIX}${variant}/${fileName}`;
}
