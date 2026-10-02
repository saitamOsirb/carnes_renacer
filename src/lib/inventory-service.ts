import "server-only";

import { InventoryMovementType, Prisma } from "@prisma/client";
import { roundQuantity, toQuantityNumber, type QuantityValue } from "@/lib/quantity";
import { HttpError } from "@/lib/security";
import { reconcileWarehouseLocationStock } from "@/lib/warehouse-location-service";

type InventoryTx = Prisma.TransactionClient;

type ReservableOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: QuantityValue;
  inventoryReservations: Array<{ warehouseId: string; quantity: QuantityValue }>;
};

export async function syncProductInventory(tx: InventoryTx, productId: string): Promise<void> {
  const stocks = await tx.inventoryStock.findMany({
    where: { productId, warehouse: { active: true } },
    select: { onHand: true, reserved: true },
  });

  const stock = roundQuantity(stocks.reduce((sum, item) => {
    const onHand = toQuantityNumber(item.onHand);
    const reserved = toQuantityNumber(item.reserved);
    return sum + Math.max(0, onHand - reserved);
  }, 0));
  const reserved = roundQuantity(stocks.reduce((sum, item) => sum + toQuantityNumber(item.reserved), 0));

  await tx.product.update({
    where: { id: productId },
    data: { stock, reserved },
  });
}

export async function reserveProductInventory(
  tx: InventoryTx,
  productId: string,
  quantityValue: QuantityValue,
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

  let remaining = roundQuantity(toQuantityNumber(quantityValue));
  for (const stock of stocks) {
    if (remaining <= 0) break;
    const onHand = toQuantityNumber(stock.onHand);
    const reserved = toQuantityNumber(stock.reserved);
    const available = roundQuantity(Math.max(0, onHand - reserved));
    if (available <= 0) continue;

    const take = roundQuantity(Math.min(available, remaining));
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
        onHandAfter: onHand,
        reservedAfter: roundQuantity(reserved + take),
        note: `Reserva para pedido de ${productName}`,
        reference: orderItemId,
      },
    });
    remaining = roundQuantity(remaining - take);
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
  const itemQuantity = toQuantityNumber(item.quantity);
  if (!fallback || toQuantityNumber(fallback.reserved) < itemQuantity) {
    throw new HttpError(409, `No existe una reserva de inventario consistente para ${item.productName}.`, "INVENTORY_RESERVATION_MISSING");
  }
  return [{ warehouseId: fallback.warehouseId, quantity: item.quantity }];
}

export async function releaseItemInventoryReservation(tx: InventoryTx, item: ReservableOrderItem): Promise<void> {
  const reservations = await resolveReservations(tx, item);

  for (const reservation of reservations) {
    const quantity = roundQuantity(toQuantityNumber(reservation.quantity));
    const stock = await tx.inventoryStock.findUnique({
      where: { warehouseId_productId: { warehouseId: reservation.warehouseId, productId: item.productId } },
    });
    const currentReserved = stock ? toQuantityNumber(stock.reserved) : 0;
    if (!stock || currentReserved < quantity) {
      throw new HttpError(409, `Reserva inconsistente para ${item.productName}.`, "INVENTORY_RESERVATION_INVALID");
    }

    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: { reserved: { decrement: quantity } },
    });
    await tx.inventoryMovement.create({
      data: {
        warehouseId: reservation.warehouseId,
        productId: item.productId,
        type: InventoryMovementType.RESERVATION_RELEASE,
        quantity,
        onHandAfter: stock.onHand,
        reservedAfter: roundQuantity(currentReserved - quantity),
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
    const quantity = roundQuantity(toQuantityNumber(reservation.quantity));
    const stock = await tx.inventoryStock.findUnique({
      where: { warehouseId_productId: { warehouseId: reservation.warehouseId, productId: item.productId } },
    });
    const reserved = stock ? toQuantityNumber(stock.reserved) : 0;
    const onHand = stock ? toQuantityNumber(stock.onHand) : 0;
    if (!stock || reserved < quantity || onHand < quantity) {
      throw new HttpError(409, `Inventario inconsistente para ${item.productName}.`, "INVENTORY_INVALID");
    }

    const onHandAfter = roundQuantity(onHand - quantity);
    const reservedAfter = roundQuantity(reserved - quantity);
    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: {
        onHand: { decrement: quantity },
        reserved: { decrement: quantity },
      },
    });
    await tx.inventoryMovement.create({
      data: {
        warehouseId: reservation.warehouseId,
        productId: item.productId,
        type: InventoryMovementType.SALE,
        quantity: -quantity,
        onHandAfter,
        reservedAfter,
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
