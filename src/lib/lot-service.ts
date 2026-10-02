import "server-only";

import { randomUUID } from "node:crypto";
import { LotMovementType, Prisma } from "@prisma/client";
import { roundQuantity, toQuantityNumber } from "@/lib/quantity";

type InventoryTx = Prisma.TransactionClient;

export type LotAllocation = { lotId: string; quantity: number };

export type ReceiveLotInput = {
  warehouseId: string;
  productId: string;
  supplierId?: string | null;
  purchaseReceiptItemId?: string | null;
  supplierLotNumber?: string | null;
  unitCostNet?: number | null;
  manufacturedAt?: Date | null;
  expirationDate?: Date | null;
  quantity: number;
  reference?: string | null;
  note?: string | null;
};

export type ProducedLotInput = {
  warehouseId: string;
  productId: string;
  quantity: number;
  unitCostNet?: number | null;
  manufacturedAt?: Date | null;
  expirationDate?: Date | null;
  reference?: string | null;
  note?: string | null;
};

function lotCode(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `LOT-${date}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function clean(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim().slice(0, max) ?? "";
  return normalized || null;
}

function normalizeUnitCost(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000_000 ? value : null;
}

function compareLots(
  left: { lot: { expirationDate: Date | null; manufacturedAt: Date | null; createdAt: Date } },
  right: { lot: { expirationDate: Date | null; manufacturedAt: Date | null; createdAt: Date } },
): number {
  const leftExpiry = left.lot.expirationDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightExpiry = right.lot.expirationDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  const leftManufactured = left.lot.manufacturedAt?.getTime() ?? left.lot.createdAt.getTime();
  const rightManufactured = right.lot.manufacturedAt?.getTime() ?? right.lot.createdAt.getTime();
  return leftManufactured - rightManufactured;
}

async function untrackedLot(tx: InventoryTx, productId: string) {
  const internalCode = `UNTRACKED-${productId}`.slice(0, 60);
  return tx.productLot.upsert({
    where: { internalCode },
    update: {},
    create: { internalCode, productId },
  });
}

async function reduceLotPlacements(tx: InventoryTx, warehouseId: string, lotId: string, quantity: number): Promise<void> {
  let remaining = roundQuantity(quantity);
  const placements = await tx.warehouseLotPlacement.findMany({
    where: { warehouseId, lotId, quantity: { gt: 0 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const placement of placements) {
    if (remaining <= 0) break;
    const current = toQuantityNumber(placement.quantity);
    const take = roundQuantity(Math.min(current, remaining));
    const after = roundQuantity(current - take);
    if (after <= 0) await tx.warehouseLotPlacement.delete({ where: { id: placement.id } });
    else await tx.warehouseLotPlacement.update({ where: { id: placement.id }, data: { quantity: after } });
    remaining = roundQuantity(remaining - take);
  }
}

async function adjustLotBalance(
  tx: InventoryTx,
  lotId: string,
  warehouseId: string,
  delta: number,
  type: LotMovementType,
  reference?: string | null,
  note?: string | null,
): Promise<void> {
  const stock = await tx.inventoryLotStock.upsert({
    where: { lotId_warehouseId: { lotId, warehouseId } },
    update: {},
    create: { lotId, warehouseId, onHand: 0 },
  });
  const current = toQuantityNumber(stock.onHand);
  const after = roundQuantity(current + delta);
  if (after < -1e-9) throw new Error("LOT_STOCK_NEGATIVE");
  await tx.inventoryLotStock.update({ where: { id: stock.id }, data: { onHand: Math.max(0, after) } });
  await tx.inventoryLotMovement.create({
    data: {
      lotId,
      warehouseId,
      type,
      quantity: delta,
      balanceAfter: Math.max(0, after),
      reference: clean(reference, 100),
      note: clean(note, 500),
    },
  });
}

export async function reconcileLotStockWithAggregate(
  tx: InventoryTx,
  warehouseId: string,
  productId: string,
  aggregateOnHandValue: Prisma.Decimal | number,
  reference = "LOT-RECONCILE",
): Promise<void> {
  const aggregateOnHand = roundQuantity(toQuantityNumber(aggregateOnHandValue));
  const lotStocks = await tx.inventoryLotStock.findMany({
    where: { warehouseId, lot: { productId }, onHand: { gt: 0 } },
    include: { lot: true },
  });
  const lotTotal = roundQuantity(lotStocks.reduce((sum, item) => sum + toQuantityNumber(item.onHand), 0));
  const delta = roundQuantity(aggregateOnHand - lotTotal);
  if (Math.abs(delta) < 0.001) return;

  if (delta > 0) {
    const lot = await untrackedLot(tx, productId);
    await adjustLotBalance(
      tx,
      lot.id,
      warehouseId,
      delta,
      LotMovementType.ADJUSTMENT,
      reference,
      "Stock sin lote identificado reconciliado automáticamente",
    );
    return;
  }

  let remaining = Math.abs(delta);
  const ordered = [...lotStocks].sort((a, b) => {
    const aUntracked = a.lot.internalCode.startsWith("UNTRACKED-") || a.lot.internalCode.startsWith("LEGACY-");
    const bUntracked = b.lot.internalCode.startsWith("UNTRACKED-") || b.lot.internalCode.startsWith("LEGACY-");
    if (aUntracked !== bUntracked) return aUntracked ? -1 : 1;
    return compareLots(b, a);
  });
  for (const item of ordered) {
    if (remaining <= 0) break;
    const take = roundQuantity(Math.min(toQuantityNumber(item.onHand), remaining));
    await adjustLotBalance(
      tx,
      item.lotId,
      warehouseId,
      -take,
      LotMovementType.ADJUSTMENT,
      reference,
      "Reducción automática para reconciliar con stock físico",
    );
    await reduceLotPlacements(tx, warehouseId, item.lotId, take);
    remaining = roundQuantity(remaining - take);
  }
  if (remaining > 0.0001) throw new Error("LOT_RECONCILE_FAILED");
}

export async function createReceivedLot(tx: InventoryTx, input: ReceiveLotInput) {
  const quantity = roundQuantity(input.quantity);
  if (quantity <= 0) throw new Error("INVALID_LOT_QUANTITY");
  if (input.manufacturedAt && input.expirationDate && input.expirationDate.getTime() < input.manufacturedAt.getTime()) {
    throw new Error("INVALID_LOT_DATES");
  }
  const lot = await tx.productLot.create({
    data: {
      internalCode: lotCode(),
      productId: input.productId,
      supplierId: input.supplierId ?? null,
      purchaseReceiptItemId: input.purchaseReceiptItemId ?? null,
      supplierLotNumber: clean(input.supplierLotNumber, 100),
      unitCostNet: normalizeUnitCost(input.unitCostNet),
      manufacturedAt: input.manufacturedAt ?? null,
      expirationDate: input.expirationDate ?? null,
    },
  });
  await adjustLotBalance(
    tx,
    lot.id,
    input.warehouseId,
    quantity,
    LotMovementType.RECEIVE,
    input.reference,
    input.note ?? "Recepción de compra",
  );
  return lot;
}

export async function createProducedLot(tx: InventoryTx, input: ProducedLotInput) {
  const quantity = roundQuantity(input.quantity);
  if (quantity <= 0) throw new Error("INVALID_LOT_QUANTITY");
  if (input.manufacturedAt && input.expirationDate && input.expirationDate.getTime() < input.manufacturedAt.getTime()) {
    throw new Error("INVALID_LOT_DATES");
  }
  const lot = await tx.productLot.create({
    data: {
      internalCode: lotCode(),
      productId: input.productId,
      unitCostNet: normalizeUnitCost(input.unitCostNet),
      manufacturedAt: input.manufacturedAt ?? null,
      expirationDate: input.expirationDate ?? null,
    },
  });
  await adjustLotBalance(
    tx,
    lot.id,
    input.warehouseId,
    quantity,
    LotMovementType.PRODUCTION_OUTPUT,
    input.reference,
    input.note ?? "Lote generado por producción",
  );
  return lot;
}

export async function consumeSpecificLot(
  tx: InventoryTx,
  warehouseId: string,
  lotId: string,
  quantityValue: number,
  options: {
    type?: LotMovementType;
    reference?: string | null;
    note?: string | null;
    aggregateOnHandBefore?: Prisma.Decimal | number;
  },
): Promise<LotAllocation> {
  const quantity = roundQuantity(quantityValue);
  if (quantity <= 0) throw new Error("INVALID_LOT_QUANTITY");
  const lot = await tx.productLot.findUnique({ where: { id: lotId }, select: { id: true, productId: true } });
  if (!lot) throw new Error("LOT_NOT_FOUND");

  if (options.aggregateOnHandBefore != null) {
    await reconcileLotStockWithAggregate(
      tx,
      warehouseId,
      lot.productId,
      options.aggregateOnHandBefore,
      options.reference ?? "LOT-RECONCILE",
    );
  }

  const stock = await tx.inventoryLotStock.findUnique({ where: { lotId_warehouseId: { lotId, warehouseId } } });
  if (!stock || toQuantityNumber(stock.onHand) + 1e-9 < quantity) throw new Error("LOT_STOCK_NOT_AVAILABLE");
  await adjustLotBalance(
    tx,
    lotId,
    warehouseId,
    -quantity,
    options.type ?? LotMovementType.ISSUE,
    options.reference,
    options.note,
  );
  await reduceLotPlacements(tx, warehouseId, lotId, quantity);
  return { lotId, quantity };
}

export async function consumeLotsFefo(
  tx: InventoryTx,
  warehouseId: string,
  productId: string,
  quantityValue: number,
  options: {
    type: LotMovementType;
    reference?: string | null;
    note?: string | null;
    aggregateOnHandBefore?: Prisma.Decimal | number;
  },
): Promise<LotAllocation[]> {
  const quantity = roundQuantity(quantityValue);
  if (quantity <= 0) return [];
  if (options.aggregateOnHandBefore != null) {
    await reconcileLotStockWithAggregate(
      tx,
      warehouseId,
      productId,
      options.aggregateOnHandBefore,
      options.reference ?? "LOT-RECONCILE",
    );
  }

  const stocks = await tx.inventoryLotStock.findMany({
    where: { warehouseId, lot: { productId }, onHand: { gt: 0 } },
    include: { lot: true },
  });
  stocks.sort(compareLots);
  const total = roundQuantity(stocks.reduce((sum, item) => sum + toQuantityNumber(item.onHand), 0));
  if (total + 1e-9 < quantity) throw new Error("LOT_STOCK_NOT_AVAILABLE");

  let remaining = quantity;
  const allocations: LotAllocation[] = [];
  for (const stock of stocks) {
    if (remaining <= 0) break;
    const take = roundQuantity(Math.min(toQuantityNumber(stock.onHand), remaining));
    if (take <= 0) continue;
    await adjustLotBalance(tx, stock.lotId, warehouseId, -take, options.type, options.reference, options.note);
    await reduceLotPlacements(tx, warehouseId, stock.lotId, take);
    allocations.push({ lotId: stock.lotId, quantity: take });
    remaining = roundQuantity(remaining - take);
  }
  return allocations;
}

export async function restoreLotAllocations(
  tx: InventoryTx,
  warehouseId: string,
  allocations: LotAllocation[],
  options: { type?: LotMovementType; reference?: string | null; note?: string | null },
): Promise<void> {
  for (const allocation of allocations) {
    if (allocation.quantity <= 0) continue;
    await adjustLotBalance(
      tx,
      allocation.lotId,
      warehouseId,
      roundQuantity(allocation.quantity),
      options.type ?? LotMovementType.RETURN,
      options.reference,
      options.note,
    );
  }
}

export async function restoreUntrackedLot(
  tx: InventoryTx,
  warehouseId: string,
  productId: string,
  quantity: number,
  options: { type?: LotMovementType; reference?: string | null; note?: string | null },
): Promise<LotAllocation> {
  const lot = await untrackedLot(tx, productId);
  const normalized = roundQuantity(quantity);
  await adjustLotBalance(
    tx,
    lot.id,
    warehouseId,
    normalized,
    options.type ?? LotMovementType.RETURN,
    options.reference,
    options.note ?? "Entrada sin lote histórico identificable",
  );
  return { lotId: lot.id, quantity: normalized };
}

export async function receiveTransferredLots(
  tx: InventoryTx,
  warehouseId: string,
  allocations: LotAllocation[],
  reference?: string | null,
): Promise<void> {
  await restoreLotAllocations(tx, warehouseId, allocations, {
    type: LotMovementType.TRANSFER_IN,
    reference,
    note: "Recepción de lote por traslado interno",
  });
}
