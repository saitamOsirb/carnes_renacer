import "server-only";

import { InventoryMovementType, Prisma } from "@prisma/client";
import { HttpError } from "@/lib/security";
import { reconcileWarehouseLocationStock } from "@/lib/warehouse-location-service";

type InventoryTx = Prisma.TransactionClient;

type ReservableOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  inventoryReservations: Array<{ warehouseId: string; quantity: number }>;
};

export async function syncProductInventory(tx: InventoryTx, productId: string): Promise<void> {
  const stocks = await tx.inventoryStock.findMany({
    where: { productId, warehouse: { active: true } },
    select: { onHand: true, reserved: true },
  });

  const stock = stocks.reduce((sum, item) => sum + Math.max(0, item.onHand - item.reserved), 0);
  const reserved = stocks.reduce((sum, item) => sum + item.reserved, 0);

  await tx.product.update({
    where: { id: productId },
    data: { stock, reserved },
  });
}

export async function reserveProductInventory(
  tx: InventoryTx,
  productId: string,
  quantity: number,
  orderItemId: string,
  productName: string,
): Promise<void> {
  const stocks = await tx.inventoryStock.findMany({
    where: { productId, warehouse: { active: true } },
    include: { warehouse: true },
  });

  stocks.sort((left, right) => {
    if (left.warehouse.isDefault !== right.warehouse.isDefault) return left.warehouse.isDefault ? -1 : 1;
    return left.warehouse.name.localeCompare(right.warehouse.name, "es");
  });

  let remaining = quantity;
  for (const stock of stocks) {
    if (remaining <= 0) break;
    const available = Math.max(0, stock.onHand - stock.reserved);
    if (available <= 0) continue;

    const take = Math.min(available, remaining);
    const updated = await tx.inventoryStock.updateMany({
      where: { id: stock.id, onHand: stock.onHand, reserved: stock.reserved },
      data: { reserved: { increment: take } },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "El inventario cambió mientras se procesaba el pedido. Intenta nuevamente.", "INVENTORY_CHANGED");
    }

    await tx.inventoryReservation.create({
      data: { orderItemId, warehouseId: stock.warehouseId, quantity: take },
    });
    await tx.inventoryMovement.create({
      data: {
        warehouseId: stock.warehouseId,
        productId,
        type: InventoryMovementType.RESERVATION,
        quantity: take,
        onHandAfter: stock.onHand,
        reservedAfter: stock.reserved + take,
        note: `Reserva para pedido de ${productName}`,
        reference: orderItemId,
      },
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new HttpError(409, `Stock insuficiente para ${productName}.`, "INSUFFICIENT_STOCK");
  }

  await syncProductInventory(tx, productId);
}

async function resolveReservations(tx: InventoryTx, item: ReservableOrderItem) {
  if (item.inventoryReservations.length > 0) return item.inventoryReservations;

  const fallback = await tx.inventoryStock.findFirst({
    where: { productId: item.productId, warehouse: { isDefault: true } },
    select: { warehouseId: true, reserved: true },
  });
  if (!fallback || fallback.reserved < item.quantity) {
    throw new HttpError(409, `No existe una reserva de inventario consistente para ${item.productName}.`, "INVENTORY_RESERVATION_MISSING");
  }
  return [{ warehouseId: fallback.warehouseId, quantity: item.quantity }];
}

export async function releaseItemInventoryReservation(tx: InventoryTx, item: ReservableOrderItem): Promise<void> {
  const reservations = await resolveReservations(tx, item);

  for (const reservation of reservations) {
    const stock = await tx.inventoryStock.findUnique({
      where: { warehouseId_productId: { warehouseId: reservation.warehouseId, productId: item.productId } },
    });
    if (!stock || stock.reserved < reservation.quantity) {
      throw new HttpError(409, `Reserva inconsistente para ${item.productName}.`, "INVENTORY_RESERVATION_INVALID");
    }

    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: { reserved: { decrement: reservation.quantity } },
    });
    await tx.inventoryMovement.create({
      data: {
        warehouseId: reservation.warehouseId,
        productId: item.productId,
        type: InventoryMovementType.RESERVATION_RELEASE,
        quantity: reservation.quantity,
        onHandAfter: stock.onHand,
        reservedAfter: stock.reserved - reservation.quantity,
        note: `Liberación de reserva de ${item.productName}`,
        reference: item.id,
      },
    });
  }

  await tx.inventoryReservation.deleteMany({ where: { orderItemId: item.id } });
  await syncProductInventory(tx, item.productId);
}

export async function consumeItemInventoryReservation(tx: InventoryTx, item: ReservableOrderItem): Promise<void> {
  const reservations = await resolveReservations(tx, item);

  for (const reservation of reservations) {
    const stock = await tx.inventoryStock.findUnique({
      where: { warehouseId_productId: { warehouseId: reservation.warehouseId, productId: item.productId } },
    });
    if (!stock || stock.reserved < reservation.quantity || stock.onHand < reservation.quantity) {
      throw new HttpError(409, `Inventario inconsistente para ${item.productName}.`, "INVENTORY_INVALID");
    }

    const onHandAfter = stock.onHand - reservation.quantity;
    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: {
        onHand: { decrement: reservation.quantity },
        reserved: { decrement: reservation.quantity },
      },
    });
    await tx.inventoryMovement.create({
      data: {
        warehouseId: reservation.warehouseId,
        productId: item.productId,
        type: InventoryMovementType.SALE,
        quantity: -reservation.quantity,
        onHandAfter,
        reservedAfter: stock.reserved - reservation.quantity,
        note: `Salida por venta de ${item.productName}`,
        reference: item.id,
      },
    });
    await reconcileWarehouseLocationStock(tx, reservation.warehouseId, item.productId, onHandAfter, {
      reference: item.id,
      note: `Salida automática de ubicación por venta de ${item.productName}`,
      actor: "order",
    });
  }

  await tx.inventoryReservation.deleteMany({ where: { orderItemId: item.id } });
  await syncProductInventory(tx, item.productId);
}
