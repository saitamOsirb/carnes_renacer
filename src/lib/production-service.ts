import "server-only";

import { randomUUID } from "node:crypto";
import {
  InventoryMovementType,
  LotMovementType,
  Prisma,
  ProductionProcessType,
  ProductionWasteType,
  UnitType,
  type ProductionBatch,
} from "@prisma/client";
import { syncProductInventory } from "@/lib/inventory-service";
import { consumeSpecificLot, createProducedLot } from "@/lib/lot-service";
import { prisma } from "@/lib/prisma";
import { calculateQuantitySubtotal, roundQuantity, toQuantityNumber } from "@/lib/quantity";
import { reconcileWarehouseLocationStock } from "@/lib/warehouse-location-service";

export class ProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionError";
  }
}

export type ProductionInputLine = {
  lotId: string;
  quantity: number;
};

export type ProductionOutputLine = {
  productId: string;
  quantity: number;
  manufacturedAt?: Date | null;
  expirationDate?: Date | null;
};

export type ProductionWasteLine = {
  type: ProductionWasteType;
  quantity: number;
  sourceProductId?: string | null;
  note?: string | null;
};

export type CreateProductionBatchInput = {
  requestKey: string;
  warehouseId: string;
  processType: ProductionProcessType;
  performedBy: string;
  notes?: string | null;
  inputs: ProductionInputLine[];
  outputs: ProductionOutputLine[];
  wastes?: ProductionWasteLine[];
};

function clean(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim().slice(0, max) ?? "";
  return normalized || null;
}

function required(value: string | null | undefined, label: string, max: number): string {
  const normalized = clean(value, max);
  if (!normalized) throw new ProductionError(`${label} es obligatorio.`);
  return normalized;
}

function productionNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `PROD-${date}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function validQuantity(value: number): boolean {
  const rounded = roundQuantity(value);
  return Number.isFinite(value) && rounded >= 0.001 && rounded <= 10_000_000 && Math.abs(value - rounded) < 1e-9;
}

function normalizeRequestKey(value: string): string {
  const key = value.trim().slice(0, 64);
  if (key.length < 8) throw new ProductionError("La operación no tiene una clave de idempotencia válida.");
  return key;
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function parseProductionProcessType(value: string): ProductionProcessType {
  if (Object.values(ProductionProcessType).includes(value as ProductionProcessType)) return value as ProductionProcessType;
  return ProductionProcessType.DESPOSTE;
}

export function parseProductionWasteType(value: string): ProductionWasteType {
  if (Object.values(ProductionWasteType).includes(value as ProductionWasteType)) return value as ProductionWasteType;
  return ProductionWasteType.MERMA_PROCESO;
}

export async function createProductionBatch(input: CreateProductionBatchInput): Promise<ProductionBatch> {
  const requestKey = normalizeRequestKey(input.requestKey);
  const existing = await prisma.productionBatch.findUnique({ where: { requestKey } });
  if (existing) return existing;

  const warehouseId = input.warehouseId.trim().slice(0, 30);
  const performedBy = required(input.performedBy, "El responsable", 80);
  if (!warehouseId) throw new ProductionError("Selecciona la bodega donde se realizará la producción.");
  if (!Array.isArray(input.inputs) || input.inputs.length < 1 || input.inputs.length > 50) {
    throw new ProductionError("La producción debe tener entre 1 y 50 lotes de entrada.");
  }
  if (!Array.isArray(input.outputs) || input.outputs.length < 1 || input.outputs.length > 50) {
    throw new ProductionError("La producción debe generar entre 1 y 50 productos de salida.");
  }
  if ((input.wastes?.length ?? 0) > 30) throw new ProductionError("La producción supera el máximo de 30 líneas de merma.");

  const normalizedInputs = input.inputs.map((line) => ({
    lotId: typeof line.lotId === "string" ? line.lotId.slice(0, 30) : "",
    quantity: roundQuantity(Number(line.quantity)),
  }));
  if (normalizedInputs.some((line) => !line.lotId || !validQuantity(line.quantity))) {
    throw new ProductionError("Uno o más lotes de entrada tienen una cantidad inválida.");
  }
  if (new Set(normalizedInputs.map((line) => line.lotId)).size !== normalizedInputs.length) {
    throw new ProductionError("No repitas el mismo lote de entrada dentro de una producción.");
  }

  const normalizedOutputs = input.outputs.map((line) => ({
    productId: typeof line.productId === "string" ? line.productId.slice(0, 30) : "",
    quantity: roundQuantity(Number(line.quantity)),
    manufacturedAt: line.manufacturedAt ?? null,
    expirationDate: line.expirationDate ?? null,
  }));
  if (normalizedOutputs.some((line) => !line.productId || !validQuantity(line.quantity))) {
    throw new ProductionError("Uno o más productos de salida tienen una cantidad inválida.");
  }
  if (new Set(normalizedOutputs.map((line) => line.productId)).size !== normalizedOutputs.length) {
    throw new ProductionError("Agrupa cada producto de salida en una sola línea.");
  }
  for (const output of normalizedOutputs) {
    if (output.manufacturedAt && output.expirationDate && output.expirationDate.getTime() < output.manufacturedAt.getTime()) {
      throw new ProductionError("El vencimiento de una salida no puede ser anterior a su elaboración.");
    }
  }

  const normalizedWastes = (input.wastes ?? []).map((line) => ({
    type: line.type,
    quantity: roundQuantity(Number(line.quantity)),
    sourceProductId: clean(line.sourceProductId, 30),
    note: clean(line.note, 500),
  })).filter((line) => line.quantity > 0);
  if (normalizedWastes.some((line) => !validQuantity(line.quantity))) {
    throw new ProductionError("Una o más líneas de merma tienen una cantidad inválida.");
  }

  const totalInputQuantity = roundQuantity(normalizedInputs.reduce((sum, line) => sum + line.quantity, 0));
  const totalOutputQuantity = roundQuantity(normalizedOutputs.reduce((sum, line) => sum + line.quantity, 0));
  const totalWasteQuantity = roundQuantity(normalizedWastes.reduce((sum, line) => sum + line.quantity, 0));
  if (Math.abs(roundQuantity(totalOutputQuantity + totalWasteQuantity) - totalInputQuantity) > 0.0001) {
    throw new ProductionError(
      `El balance no cuadra: entran ${totalInputQuantity.toFixed(3)} kg y deben salir exactamente productos + merma por la misma cantidad.`,
    );
  }
  const yieldPercent = Math.round((totalOutputQuantity / totalInputQuantity) * 100_000) / 1_000;
  const number = productionNumber();

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.productionBatch.findUnique({ where: { requestKey } });
      if (duplicate) return duplicate;

      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse?.active) throw new ProductionError("La bodega seleccionada no existe o está inactiva.");

      const lots = await tx.productLot.findMany({
        where: { id: { in: normalizedInputs.map((line) => line.lotId) } },
        include: {
          product: { select: { id: true, name: true, unit: true, active: true } },
          stocks: { where: { warehouseId } },
        },
      });
      if (lots.length !== normalizedInputs.length) throw new ProductionError("Uno o más lotes de entrada ya no existen.");
      const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
      const today = startOfToday();

      const resolvedInputs = normalizedInputs.map((line) => {
        const lot = lotMap.get(line.lotId);
        if (!lot) throw new ProductionError("Lote de entrada no encontrado.");
        if (!lot.product.active) throw new ProductionError(`${lot.product.name}: el producto está inactivo.`);
        if (lot.product.unit !== UnitType.KG) {
          throw new ProductionError(`${lot.product.name}: el módulo de desposte trabaja con balance físico en kilogramos.`);
        }
        const lotStock = lot.stocks[0];
        const availableLot = lotStock ? toQuantityNumber(lotStock.onHand) : 0;
        if (availableLot + 1e-9 < line.quantity) {
          throw new ProductionError(`${lot.product.name} · ${lot.internalCode}: saldo de lote insuficiente.`);
        }
        if (lot.expirationDate && lot.expirationDate.getTime() < today.getTime()) {
          throw new ProductionError(`${lot.product.name} · ${lot.internalCode}: el lote está vencido y no puede transformarse en producto vendible.`);
        }
        const totalCostNet = lot.unitCostNet == null
          ? null
          : calculateQuantitySubtotal(lot.unitCostNet, line.quantity);
        return { ...line, lot, totalCostNet };
      });

      const inputProductIds = [...new Set(resolvedInputs.map((line) => line.lot.productId))];
      const inputStocks = await tx.inventoryStock.findMany({
        where: { warehouseId, productId: { in: inputProductIds } },
      });
      const inputStockMap = new Map(inputStocks.map((stock) => [stock.productId, stock]));
      for (const productId of inputProductIds) {
        const requested = roundQuantity(resolvedInputs
          .filter((line) => line.lot.productId === productId)
          .reduce((sum, line) => sum + line.quantity, 0));
        const stock = inputStockMap.get(productId);
        const available = stock
          ? roundQuantity(toQuantityNumber(stock.onHand) - toQuantityNumber(stock.reserved))
          : 0;
        if (!stock || available + 1e-9 < requested) {
          const productName = resolvedInputs.find((line) => line.lot.productId === productId)?.lot.product.name ?? "Producto";
          throw new ProductionError(`${productName}: el stock disponible no cubre la producción porque existe stock reservado o ya consumido.`);
        }
      }

      const outputProducts = await tx.product.findMany({
        where: { id: { in: normalizedOutputs.map((line) => line.productId) }, active: true },
        select: { id: true, name: true, unit: true },
      });
      if (outputProducts.length !== normalizedOutputs.length) throw new ProductionError("Uno o más productos de salida no existen o están inactivos.");
      const outputProductMap = new Map(outputProducts.map((product) => [product.id, product]));
      for (const product of outputProducts) {
        if (product.unit !== UnitType.KG) {
          throw new ProductionError(`${product.name}: las salidas de este módulo deben estar configuradas en KG.`);
        }
      }

      const inputProductSet = new Set(inputProductIds);
      for (const waste of normalizedWastes) {
        if (waste.sourceProductId && !inputProductSet.has(waste.sourceProductId)) {
          throw new ProductionError("La merma solo puede asociarse a un producto que participe como entrada.");
        }
      }

      const allCostsKnown = resolvedInputs.every((line) => line.totalCostNet != null);
      const totalInputCost = allCostsKnown
        ? resolvedInputs.reduce((sum, line) => sum + (line.totalCostNet ?? 0), 0)
        : null;

      let remainingCost = totalInputCost ?? 0;
      const costedOutputs = normalizedOutputs.map((line, index) => {
        let allocatedCostNet: number | null = null;
        let unitCostNet: number | null = null;
        if (totalInputCost != null) {
          const last = index === normalizedOutputs.length - 1;
          allocatedCostNet = last
            ? remainingCost
            : Math.min(remainingCost, Math.round(totalInputCost * line.quantity / totalOutputQuantity));
          remainingCost -= allocatedCostNet;
          unitCostNet = line.quantity > 0 ? Math.round(allocatedCostNet / line.quantity) : null;
        }
        return { ...line, allocatedCostNet, unitCostNet };
      });

      const batch = await tx.productionBatch.create({
        data: {
          productionNumber: number,
          requestKey,
          warehouseId,
          processType: input.processType,
          performedBy,
          notes: clean(input.notes, 1000),
          totalInputQuantity,
          totalOutputQuantity,
          totalWasteQuantity,
          yieldPercent,
          totalInputCost,
        },
      });

      await tx.productionInput.createMany({
        data: resolvedInputs.map((line) => ({
          productionBatchId: batch.id,
          lotId: line.lot.id,
          productId: line.lot.productId,
          productName: line.lot.product.name,
          unit: line.lot.product.unit,
          quantity: line.quantity,
          unitCostNet: line.lot.unitCostNet,
          totalCostNet: line.totalCostNet,
        })),
      });

      for (const line of resolvedInputs) {
        const stock = inputStockMap.get(line.lot.productId);
        if (!stock) throw new ProductionError("El inventario agregado cambió durante la producción.");
        await consumeSpecificLot(tx, warehouseId, line.lot.id, line.quantity, {
          type: LotMovementType.PRODUCTION_CONSUME,
          reference: number,
          note: `Consumo de lote para ${input.processType.toLowerCase()} ${number}`,
        });
      }

      for (const productId of inputProductIds) {
        const stock = inputStockMap.get(productId);
        if (!stock) throw new ProductionError("Stock agregado de entrada no encontrado.");
        const quantity = roundQuantity(resolvedInputs
          .filter((line) => line.lot.productId === productId)
          .reduce((sum, line) => sum + line.quantity, 0));
        const onHand = toQuantityNumber(stock.onHand);
        const reserved = toQuantityNumber(stock.reserved);
        const onHandAfter = roundQuantity(onHand - quantity);
        const changed = await tx.inventoryStock.updateMany({
          where: { id: stock.id, onHand: stock.onHand, reserved: stock.reserved },
          data: { onHand: { decrement: quantity } },
        });
        if (changed.count !== 1) throw new ProductionError("El inventario cambió mientras se consumía materia prima. Intenta nuevamente.");
        await tx.inventoryMovement.create({
          data: {
            warehouseId,
            productId,
            type: InventoryMovementType.PRODUCTION_CONSUME,
            quantity: -quantity,
            onHandAfter,
            reservedAfter: reserved,
            reference: number,
            note: `Materia prima consumida por producción ${number}`,
          },
        });
        await reconcileWarehouseLocationStock(tx, warehouseId, productId, onHandAfter, {
          reference: number,
          note: `Salida WMS por producción ${number}`,
          actor: performedBy,
        });
        await syncProductInventory(tx, productId);
      }

      const inheritedExpiry = resolvedInputs
        .map((line) => line.lot.expirationDate)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const manufacturedDefault = new Date();

      for (const output of costedOutputs) {
        const product = outputProductMap.get(output.productId);
        if (!product) throw new ProductionError("Producto de salida no encontrado durante la transacción.");
        const manufacturedAt = output.manufacturedAt ?? manufacturedDefault;
        const expirationDate = output.expirationDate ?? inheritedExpiry;
        if (expirationDate && expirationDate.getTime() < manufacturedAt.getTime()) {
          throw new ProductionError(`${product.name}: el vencimiento resultante es anterior a la fecha de elaboración.`);
        }

        const lot = await createProducedLot(tx, {
          warehouseId,
          productId: product.id,
          quantity: output.quantity,
          unitCostNet: output.unitCostNet,
          manufacturedAt,
          expirationDate,
          reference: number,
          note: `Lote generado por producción ${number}`,
        });

        const stock = await tx.inventoryStock.upsert({
          where: { warehouseId_productId: { warehouseId, productId: product.id } },
          create: { warehouseId, productId: product.id, onHand: output.quantity, reserved: 0, minStock: 0 },
          update: { onHand: { increment: output.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            warehouseId,
            productId: product.id,
            type: InventoryMovementType.PRODUCTION_OUTPUT,
            quantity: output.quantity,
            onHandAfter: stock.onHand,
            reservedAfter: stock.reserved,
            reference: number,
            note: `Producto terminado generado por ${number}`,
          },
        });
        await tx.productionOutput.create({
          data: {
            productionBatchId: batch.id,
            lotId: lot.id,
            productId: product.id,
            productName: product.name,
            unit: product.unit,
            quantity: output.quantity,
            allocatedCostNet: output.allocatedCostNet,
            unitCostNet: output.unitCostNet,
            manufacturedAt,
            expirationDate,
          },
        });
        await syncProductInventory(tx, product.id);
      }

      if (normalizedWastes.length > 0) {
        const inputNames = new Map(resolvedInputs.map((line) => [line.lot.productId, line.lot.product.name]));
        await tx.productionWaste.createMany({
          data: normalizedWastes.map((waste) => ({
            productionBatchId: batch.id,
            sourceProductId: waste.sourceProductId,
            sourceProductName: waste.sourceProductId ? inputNames.get(waste.sourceProductId) ?? null : null,
            type: waste.type,
            quantity: waste.quantity,
            note: waste.note,
          })),
        });
      }

      return batch;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ProductionError) throw error;
    if (isUniqueError(error)) {
      const duplicate = await prisma.productionBatch.findUnique({ where: { requestKey } });
      if (duplicate) return duplicate;
    }
    if (error instanceof Error && error.message === "LOT_STOCK_NOT_AVAILABLE") {
      throw new ProductionError("El saldo de uno de los lotes cambió durante la producción. Recarga e intenta nuevamente.");
    }
    throw error;
  }
}
