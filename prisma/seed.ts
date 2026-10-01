import { InventoryMovementType, PrismaClient, UnitType } from "@prisma/client";
import { catalogProducts } from "../src/data/catalog";

const prisma = new PrismaClient();
const DEFAULT_WAREHOUSE_ID = "warehouse-central";
const DEFAULT_CASH_REGISTER_ID = "cash-register-1";

async function main() {
  const warehouse = await prisma.warehouse.upsert({
    where: { id: DEFAULT_WAREHOUSE_ID },
    update: {},
    create: {
      id: DEFAULT_WAREHOUSE_ID,
      code: "CENTRAL",
      name: "Bodega principal",
      active: true,
      isDefault: true,
    },
  });

  await prisma.cashRegister.upsert({
    where: { id: DEFAULT_CASH_REGISTER_ID },
    update: {},
    create: {
      id: DEFAULT_CASH_REGISTER_ID,
      code: "CAJA-1",
      name: "Caja 1",
      warehouseId: warehouse.id,
      active: true,
    },
  });

  for (const product of catalogProducts) {
    const savedProduct = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: {
        id: product.slug,
        ...product,
        unit: UnitType[product.unit],
        active: true,
      },
    });

    const existingStock = await prisma.inventoryStock.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: savedProduct.id } },
      select: { id: true },
    });

    if (!existingStock) {
      const onHand = savedProduct.stock + savedProduct.reserved;
      await prisma.$transaction(async (tx) => {
        await tx.inventoryStock.create({
          data: {
            warehouseId: warehouse.id,
            productId: savedProduct.id,
            onHand,
            reserved: savedProduct.reserved,
            minStock: 0,
          },
        });
        if (onHand > 0) {
          await tx.inventoryMovement.create({
            data: {
              warehouseId: warehouse.id,
              productId: savedProduct.id,
              type: InventoryMovementType.OPENING,
              quantity: onHand,
              onHandAfter: onHand,
              reservedAfter: savedProduct.reserved,
              note: "Saldo inicial creado por seed",
              reference: "seed",
            },
          });
        }
      });
    }
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

  console.log(`Seed verificado: ${catalogProducts.length} productos base, inventario inicial y caja POS sin sobrescribir cambios administrativos.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
