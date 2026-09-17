import { PrismaClient, UnitType } from "@prisma/client";
import { catalogProducts } from "../src/data/catalog";

const prisma = new PrismaClient();

async function main() {
  for (const product of catalogProducts) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        ...product,
        unit: UnitType[product.unit],
        active: true,
      },
      create: {
        id: product.slug,
        ...product,
        unit: UnitType[product.unit],
        active: true,
      },
    });
  }

  await prisma.storeSetting.upsert({
    where: { key: "checkout_whatsapp" },
    update: {},
    create: { key: "checkout_whatsapp", value: "56991851942" },
  });

  await prisma.coupon.upsert({
    where: { code: "BIENVENIDA5" },
    update: {},
    create: {
      code: "BIENVENIDA5",
      active: true,
      percentOff: 5,
      minimumSubtotal: 30000,
      usageLimit: 500,
    },
  });

  console.log(`Seed completado: ${catalogProducts.length} productos.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
