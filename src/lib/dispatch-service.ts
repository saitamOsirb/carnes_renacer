import "server-only";

import { randomUUID } from "node:crypto";
import {
  DispatchStatus,
  DispatchType,
  DteStatus,
  InventoryMovementType,
  Prisma,
  type Dispatch,
} from "@prisma/client";
import { syncProductInventory } from "@/lib/inventory-service";
import { prisma } from "@/lib/prisma";
import {
  calculateQuantitySubtotal,
  formatQuantity,
  isValidQuantityForUnit,
  roundQuantity,
  toQuantityNumber,
} from "@/lib/quantity";
import { reconcileWarehouseLocationStock } from "@/lib/warehouse-location-service";

export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}

export type DispatchTransportInput = {
  transferReasonCode?: string;
  reason: string;
  receiverRut?: string;
  receiverName: string;
  receiverGiro?: string;
  receiverAddress: string;
  receiverCommune: string;
  receiverCity?: string;
  transportCompanyRut?: string;
  transportCompanyName?: string;
  driverRut?: string;
  driverName?: string;
  vehiclePlate?: string;
  trailerPlate?: string;
  notes?: string;
};

export type CreateSaleDispatchInput = DispatchTransportInput & {
  requestKey: string;
  saleId: string;
};

export type CreateTransferDispatchInput = DispatchTransportInput & {
  requestKey: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  items: Array<{ productId: string; quantity: number }>;
};

function clean(value: string | undefined | null, max: number): string | null {
  const normalized = value?.trim().slice(0, max) ?? "";
  return normalized || null;
}

function required(value: string | undefined | null, label: string, max: number): string {
  const normalized = clean(value, max);
  if (!normalized) throw new DispatchError(`${label} es obligatorio.`);
  return normalized;
}

function requestKey(value: string): string {
  const normalized = value.trim().slice(0, 64);
  if (normalized.length < 8) throw new DispatchError("La solicitud de despacho no tiene una clave de idempotencia válida.");
  return normalized;
}

function dispatchNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `GD-${date}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function baseData(input: DispatchTransportInput) {
  return {
    transferReasonCode: clean(input.transferReasonCode, 10),
    reason: required(input.reason, "El motivo del traslado", 500),
    receiverRut: clean(input.receiverRut, 20),
    receiverName: required(input.receiverName, "El receptor", 191),
    receiverGiro: clean(input.receiverGiro, 191),
    receiverAddress: required(input.receiverAddress, "La dirección de destino", 255),
    receiverCommune: required(input.receiverCommune, "La comuna de destino", 120),
    receiverCity: clean(input.receiverCity, 120),
    transportCompanyRut: clean(input.transportCompanyRut, 20),
    transportCompanyName: clean(input.transportCompanyName, 191),
    driverRut: clean(input.driverRut, 20),
    driverName: clean(input.driverName, 191),
    vehiclePlate: clean(input.vehiclePlate, 20)?.toUpperCase() ?? null,
    trailerPlate: clean(input.trailerPlate, 20)?.toUpperCase() ?? null,
    notes: clean(input.notes, 1000),
  };
}

export async function createSaleDispatch(input: CreateSaleDispatchInput): Promise<Dispatch> {
  const key = requestKey(input.requestKey);
  const existing = await prisma.dispatch.findUnique({ where: { requestKey: key } });
  if (existing) return existing;

  const sale = await prisma.posSale.findUnique({
    where: { id: input.saleId.slice(0, 30) },
    include: { items: true, warehouse: true },
  });
  if (!sale) throw new DispatchError("Venta POS no encontrada.");
  if (sale.items.length === 0) throw new DispatchError("La venta no contiene líneas para despachar.");

  const data = baseData(input);
  return prisma.dispatch.create({
    data: {
      dispatchNumber: dispatchNumber(),
      requestKey: key,
      type: DispatchType.SALE_DELIVERY,
      status: DispatchStatus.DRAFT,
      sourceWarehouseId: sale.warehouseId,
      saleId: sale.id,
      ...data,
      items: {
        create: sale.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.subtotal,
        })),
      },
    },
  });
}

export async function createInternalTransferDispatch(input: CreateTransferDispatchInput): Promise<Dispatch> {
  const key = requestKey(input.requestKey);
  const existing = await prisma.dispatch.findUnique({ where: { requestKey: key } });
  if (existing) return existing;

  const sourceWarehouseId = input.sourceWarehouseId.slice(0, 30);
  const destinationWarehouseId = input.destinationWarehouseId.slice(0, 30);
  if (!sourceWarehouseId || !destinationWarehouseId || sourceWarehouseId === destinationWarehouseId) {
    throw new DispatchError("Selecciona bodegas de origen y destino distintas.");
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) {
    throw new DispatchError("Agrega entre 1 y 100 productos al traslado.");
  }

  const normalizedItems = input.items.map((item) => ({
    productId: typeof item.productId === "string" ? item.productId.slice(0, 30) : "",
    quantity: roundQuantity(Number(item.quantity)),
  }));
  if (normalizedItems.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    throw new DispatchError("El traslado contiene cantidades inválidas.");
  }
  if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) {
    throw new DispatchError("No repitas productos dentro del mismo traslado.");
  }

  const [source, destination, products, stocks] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: sourceWarehouseId } }),
    prisma.warehouse.findUnique({ where: { id: destinationWarehouseId } }),
    prisma.product.findMany({
      where: { id: { in: normalizedItems.map((item) => item.productId) }, active: true },
      select: { id: true, name: true, unit: true, price: true },
    }),
    prisma.inventoryStock.findMany({
      where: { warehouseId: sourceWarehouseId, productId: { in: normalizedItems.map((item) => item.productId) } },
    }),
  ]);
  if (!source?.active || !destination?.active) throw new DispatchError("La bodega de origen o destino no está activa.");
  if (products.length !== normalizedItems.length) throw new DispatchError("Uno o más productos no existen o están inactivos.");

  const productMap = new Map(products.map((product) => [product.id, product]));
  const stockMap = new Map(stocks.map((stock) => [stock.productId, stock]));
  const lines = normalizedItems.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) throw new DispatchError("Producto inválido en el traslado.");
    if (!isValidQuantityForUnit(item.quantity, product.unit)) {
      throw new DispatchError(product.unit === "KG"
        ? `${product.name}: ingresa un peso válido con hasta tres decimales.`
        : `${product.name}: las unidades solo admiten cantidades enteras.`);
    }
    const stock = stockMap.get(product.id);
    const available = stock
      ? roundQuantity(toQuantityNumber(stock.onHand) - toQuantityNumber(stock.reserved))
      : 0;
    if (available < item.quantity) {
      throw new DispatchError(`Stock insuficiente de ${product.name} en ${source.name}. Disponible: ${formatQuantity(available, product.unit)}.`);
    }
    return {
      product,
      quantity: item.quantity,
      amount: calculateQuantitySubtotal(product.price, item.quantity),
    };
  });

  const data = baseData(input);
  return prisma.dispatch.create({
    data: {
      dispatchNumber: dispatchNumber(),
      requestKey: key,
      type: DispatchType.INTERNAL_TRANSFER,
      status: DispatchStatus.DRAFT,
      sourceWarehouseId,
      destinationWarehouseId,
      ...data,
      items: {
        create: lines.map((line) => ({
          productId: line.product.id,
          productName: line.product.name,
          unit: line.product.unit,
          quantity: line.quantity,
          unitPrice: line.product.price,
          amount: line.amount,
        })),
      },
    },
  });
}

function guideIsOperational(status: DteStatus): boolean {
  return status === DteStatus.GENERATED
    || status === DteStatus.QUEUED
    || status === DteStatus.SENT
    || status === DteStatus.ACCEPTED
    || status === DteStatus.OBSERVED;
}

export async function markDispatchDispatched(dispatchIdValue: string, actor = "admin"): Promise<Dispatch> {
  const dispatchId = dispatchIdValue.slice(0, 30);
  return prisma.$transaction(async (tx) => {
    const dispatch = await tx.dispatch.findUnique({
      where: { id: dispatchId },
      include: { items: true, sourceWarehouse: true, destinationWarehouse: true, dteDocuments: true },
    });
    if (!dispatch) throw new DispatchError("Despacho no encontrado.");
    if (dispatch.status === DispatchStatus.DISPATCHED || dispatch.status === DispatchStatus.RECEIVED) return dispatch;
    if (dispatch.status === DispatchStatus.CANCELLED) throw new DispatchError("El despacho está cancelado.");

    const guide = dispatch.dteDocuments.find((document) => document.typeCode === 52 && guideIsOperational(document.status));
    if (!guide) throw new DispatchError("Emite la Guía de Despacho 52 antes de marcar la salida física.");

    if (dispatch.type === DispatchType.INTERNAL_TRANSFER) {
      if (!dispatch.destinationWarehouseId || !dispatch.destinationWarehouse?.active) {
        throw new DispatchError("El traslado interno no tiene una bodega destino activa.");
      }
      for (const item of dispatch.items) {
        const quantity = roundQuantity(toQuantityNumber(item.quantity));
        const stock = await tx.inventoryStock.findUnique({
          where: { warehouseId_productId: { warehouseId: dispatch.sourceWarehouseId, productId: item.productId } },
        });
        const onHand = stock ? toQuantityNumber(stock.onHand) : 0;
        const reserved = stock ? toQuantityNumber(stock.reserved) : 0;
        const available = roundQuantity(onHand - reserved);
        if (!stock || available < quantity) {
          throw new DispatchError(`Stock insuficiente de ${item.productName} al momento del despacho. Disponible: ${formatQuantity(available, item.unit)}.`);
        }
        const onHandAfter = roundQuantity(onHand - quantity);
        const updated = await tx.inventoryStock.updateMany({
          where: { id: stock.id, onHand: stock.onHand, reserved: stock.reserved },
          data: { onHand: { decrement: quantity } },
        });
        if (updated.count !== 1) throw new DispatchError("El inventario cambió durante el despacho. Intenta nuevamente.");

        await tx.inventoryMovement.create({
          data: {
            warehouseId: dispatch.sourceWarehouseId,
            productId: item.productId,
            type: InventoryMovementType.TRANSFER_OUT,
            quantity: -quantity,
            onHandAfter,
            reservedAfter: reserved,
            note: `Salida en tránsito ${dispatch.dispatchNumber} hacia ${dispatch.destinationWarehouse.name}`,
            reference: dispatch.dispatchNumber,
          },
        });
        await reconcileWarehouseLocationStock(tx, dispatch.sourceWarehouseId, item.productId, onHandAfter, {
          reference: dispatch.dispatchNumber,
          note: `Salida de ubicación por despacho ${dispatch.dispatchNumber}`,
          actor: actor.slice(0, 80),
        });
        await syncProductInventory(tx, item.productId);
      }
    }

    return tx.dispatch.update({
      where: { id: dispatch.id },
      data: { status: DispatchStatus.DISPATCHED, dispatchedAt: new Date() },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function markDispatchReceived(dispatchIdValue: string): Promise<Dispatch> {
  const dispatchId = dispatchIdValue.slice(0, 30);
  return prisma.$transaction(async (tx) => {
    const dispatch = await tx.dispatch.findUnique({
      where: { id: dispatchId },
      include: { items: true, destinationWarehouse: true },
    });
    if (!dispatch) throw new DispatchError("Despacho no encontrado.");
    if (dispatch.status === DispatchStatus.RECEIVED) return dispatch;
    if (dispatch.status !== DispatchStatus.DISPATCHED) throw new DispatchError("Solo un despacho en tránsito puede marcarse como recibido.");

    if (dispatch.type === DispatchType.INTERNAL_TRANSFER) {
      if (!dispatch.destinationWarehouseId || !dispatch.destinationWarehouse?.active) {
        throw new DispatchError("El traslado interno no tiene una bodega destino activa.");
      }
      for (const item of dispatch.items) {
        const quantity = roundQuantity(toQuantityNumber(item.quantity));
        const stock = await tx.inventoryStock.upsert({
          where: { warehouseId_productId: { warehouseId: dispatch.destinationWarehouseId, productId: item.productId } },
          create: {
            warehouseId: dispatch.destinationWarehouseId,
            productId: item.productId,
            onHand: quantity,
            reserved: 0,
            minStock: 0,
          },
          update: { onHand: { increment: quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            warehouseId: dispatch.destinationWarehouseId,
            productId: item.productId,
            type: InventoryMovementType.TRANSFER_IN,
            quantity,
            onHandAfter: stock.onHand,
            reservedAfter: stock.reserved,
            note: `Recepción de traslado ${dispatch.dispatchNumber}`,
            reference: dispatch.dispatchNumber,
          },
        });
        await syncProductInventory(tx, item.productId);
      }
    }

    return tx.dispatch.update({
      where: { id: dispatch.id },
      data: { status: DispatchStatus.RECEIVED, receivedAt: new Date() },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelDispatch(dispatchIdValue: string): Promise<Dispatch> {
  const dispatchId = dispatchIdValue.slice(0, 30);
  return prisma.$transaction(async (tx) => {
    const dispatch = await tx.dispatch.findUnique({
      where: { id: dispatchId },
      include: { dteDocuments: true },
    });
    if (!dispatch) throw new DispatchError("Despacho no encontrado.");
    if (dispatch.status === DispatchStatus.CANCELLED) return dispatch;
    if (dispatch.status === DispatchStatus.DISPATCHED || dispatch.status === DispatchStatus.RECEIVED) {
      throw new DispatchError("No puedes cancelar un despacho que ya movió mercadería. Debe resolverse mediante un movimiento inverso trazable.");
    }
    const activeGuide = dispatch.dteDocuments.find((document) => document.typeCode === 52 && guideIsOperational(document.status));
    if (activeGuide) throw new DispatchError(`La guía 52 folio ${activeGuide.folio} ya fue generada. No se cancelará automáticamente un DTE emitido.`);
    return tx.dispatch.update({ where: { id: dispatch.id }, data: { status: DispatchStatus.CANCELLED } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
