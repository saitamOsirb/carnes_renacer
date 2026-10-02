import "server-only";

import { prisma } from "@/lib/prisma";

const BARCODE_PREFIX = "barcode:";

export type PriceCheckerProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  price: number;
  unit: "KG" | "UNIT";
  stock: number;
  barcode: string | null;
};

export async function getPriceCheckerProducts(): Promise<PriceCheckerProduct[]> {
  const [products, barcodeSettings] = await Promise.all([
    prisma.product.findMany({
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
    }),
    prisma.storeSetting.findMany({
      where: { key: { startsWith: BARCODE_PREFIX } },
      select: { key: true, value: true },
    }),
  ]);

  const barcodeByProduct = new Map(
    barcodeSettings.map((setting) => [setting.value, setting.key.slice(BARCODE_PREFIX.length)]),
  );

  return products.map((product) => ({
    ...product,
    barcode: barcodeByProduct.get(product.id) ?? null,
  }));
}
