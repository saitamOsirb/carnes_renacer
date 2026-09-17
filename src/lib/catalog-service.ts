import "server-only";

import type { Product } from "@prisma/client";
import type { StoreProduct } from "@/components/cart-context";
import { prisma } from "@/lib/prisma";

export function toStoreProduct(product: Product): StoreProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    imageUrl: product.imageUrl,
    price: product.price,
    unit: product.unit,
    stock: Math.max(0, product.stock - product.reserved),
    featured: product.featured,
  };
}

export async function getActiveProducts(): Promise<StoreProduct[]> {
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ featured: "desc" }, { name: "asc" }],
  });
  return products.map(toStoreProduct);
}

export async function getActiveProductBySlug(slug: string): Promise<StoreProduct | null> {
  const product = await prisma.product.findFirst({ where: { slug, active: true } });
  return product ? toStoreProduct(product) : null;
}

export async function getActiveCategories(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { active: true },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((row) => row.category);
}
