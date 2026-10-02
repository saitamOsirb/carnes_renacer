import "server-only";

import { prisma } from "@/lib/prisma";

export type PriceCheckerProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  price: number;
  unit: "KG" | "UNIT";
  stock: number;
};

export async function getPriceCheckerProducts(): Promise<PriceCheckerProduct[]> {
  return prisma.product.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      category: true,
      imageUrl: true,
      price: true,
      unit: true,
      stock: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}
