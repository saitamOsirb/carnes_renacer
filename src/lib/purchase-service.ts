import "server-only";

import { randomUUID } from "node:crypto";
import {
  InventoryMovementType,
  Prisma,
  PurchaseOrderStatus,
  PurchaseReceiptDocumentType,
  type PurchaseOrder,
  type PurchaseReceipt,
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

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseError";
  }
}

export type PurchaseOrderLineInput = {
  productId: string;
  quantity: number;
  unitCostNet: number;
};

export type CreatePurchaseOrderInput = {
  requestKey: string;
  supplierId: string;
  warehouseId: string;
  expectedDate?: Date | null;
  supplierReference?: string;
  vatRate?: number;
  notes?: string;
  items: PurchaseOrderLineInput[];
};

export type PurchaseReceiptLineInput = {
  purchaseOrderItemId: string;
  quantity: number;
  unitCostNet?: number;
};

export type ReceivePurchaseOrderInput = {
  requestKey: string;
  purchaseOrderId: string;
  documentType?: PurchaseReceiptDocumentType | null;
  supplierDocumentNumber?: string;
  receivedBy: string;
  notes?: string;
  items: PurchaseReceiptLineInput[];
};

function clean(value: string | undefined | null, max: number): string | null {
  const normalized = value?.trim().slice(0, max) ?? "";
  return normalized || null;
}

function required(value: string | undefined | null, label: string, max: number): string {
  const normalized = clean(value, max);
  if (!normalized) throw new PurchaseError(`${label} es obligatorio.`);
  return normalized;
}

function normalizeRequestKey(value: string): string {
  const normalized = value.trim().slice(0, 64);
  if (normalized.length < 8) throw new PurchaseError("La operación no tiene una clave de idempotencia válida.");
  return normalized;
}

function dateCode(date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function orderNumber(): string {
  return `OC-${dateCode()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function receiptNumber(): string {
  return `REC-${dateCode()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function calculatePurchaseTax(netAmount: number, vatRate: number): { vatAmount: number; totalAmount: number } {
  if (!Number.isSafeInteger(netAmount) || netAmount < 0) throw new PurchaseError("El neto de la compra no es válido.");
  if (!Number.isInteger(vatRate) || vatRate < 0 || vatRate > 100) throw new PurchaseError("La tasa de IVA de la compra no es válida.");
  const vatAmount = Math.round(netAmount * vatRate / 100);
  return { vatAmount, totalAmount: netAmount + vatAmount };
}

function normalizeVatRate(value: number | undefined): number {
  const vatRate = value ?? 19;
  if (!Number.isInteger(vatRate) || vatRate < 0 || vatRate > 100) throw new PurchaseError("La tasa de IVA debe estar entre 0 y 100.");
  return vatRate;
}

function validMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_000_000_000;
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  const key = normalizeRequestKey(input.requestKey);
  const existing = await prisma.purchaseOrder.findUnique({ where: { requestKey: key } });
  if (existing) return existing;

  const supplierId = input.supplierId.slice(0, 30);
  const warehouseId = input.warehouseId.slice(0, 30);
  if (!supplierId || !warehouseId) throw new PurchaseError("Selecciona proveedor y bodega de recepción.");
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) {
    throw new PurchaseError("La orden debe contener entre 1 y 100 productos.");
  }

  const normalizedItems = input.items.map((item) => ({
    productId: typeof item.productId === "string" ? item.productId.slice(0, 30) : "",
    quantity: roundQuantity(Number(item.quantity)),
    unitCostNet: Number(item.unitCostNet),
  }));
  if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) {
    throw new PurchaseError("No repitas un producto dentro de la misma orden de compra.");
  }

  const [supplier, warehouse, products] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: supplierId } }),
    prisma.warehouse.findUnique({ where: { id: warehouseId } }),
    prisma.product.findMany({
      where: { id: { in: normalizedItems.map((item) => item.productId) }, active: true },
      select: { id: true, name: true, unit: true },
    }),
  ]);
  if (!supplier?.active) throw new PurchaseError("El proveedor seleccionado no está activo.");
  if (!warehouse?.active) throw new PurchaseError("La bodega seleccionada no está activa.");
  if (products.length !== normalizedItems.length) throw new PurchaseError("Uno o más productos no existen o están inactivos.");

  const productMap = new Map(products.map((product) => [product.id, product]));
  const lines = normalizedItems.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) throw new PurchaseError("Producto inválido en la orden de compra.");
    if (!isValidQuantityForUnit(item.quantity, product.unit, { max: 10_000_000 })) {
      throw new PurchaseError(product.unit === "KG"
        ? `${product.name}: el peso debe ser mayor a cero y tener hasta tres decimales.`
        : `${product.name}: la cantidad debe ser un número entero mayor a cero.`);
    }
    if (!validMoney(item.unitCostNet)) throw new PurchaseError(`${product.name}: el costo neto unitario no es válido.`);
    return {
      product,
      quantity: item.quantity,
      unitCostNet: item.unitCostNet,
      netAmount: calculateQuantitySubtotal(item.unitCostNet, item.quantity),
    };
  });

  const netAmount = lines.reduce((sum, line) => sum + line.netAmount, 0);
  const vatRate = normalizeVatRate(input.vatRate);
  const { vatAmount, totalAmount } = calculatePurchaseTax(netAmount, vatRate);
  const number = orderNumber();

  try {
    return await prisma.purchaseOrder.create({
      data: {
        orderNumber: number,
        requestKey: key,
        supplierId,
        warehouseId,
        status: PurchaseOrderStatus.ORDERED,
        expectedDate: input.expectedDate ?? null,
        supplierReference: clean(input.supplierReference, 100),
        vatRate,
        netAmount,
        vatAmount,
        totalAmount,
        notes: clean(input.notes, 1000),
        items: {
          create: lines.map((line) => ({
            productId: line.product.id,
            productName: line.product.name,
            unit: line.product.unit,
            orderedQuantity: line.quantity,
            receivedQuantity: 0,
            unitCostNet: line.unitCostNet,
            netAmount: line.netAmount,
          })),
        },
      },
    });
  } catch (error) {
    if (isUniqueError(error)) {
      const duplicate = await prisma.purchaseOrder.findUnique({ where: { requestKey: key } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

export async function cancelPurchaseOrder(purchaseOrderIdValue: string): Promise<PurchaseOrder> {
  const purchaseOrderId = purchaseOrderIdValue.slice(0, 30);
  return prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { _count: { select: { receipts: true } } },
    });
    if (!order) throw new PurchaseError("Orden de compra no encontrada.");
    if (order.status === PurchaseOrderStatus.CANCELLED) return order;
    if (order.status === PurchaseOrderStatus.RECEIVED || order._count.receipts > 0) {
      throw new PurchaseError("No puedes cancelar una orden que ya tiene recepciones. Registra un movimiento correctivo trazable si corresponde.");
    }

    const updated = await tx.purchaseOrder.updateMany({
      where: { id: order.id, status: PurchaseOrderStatus.ORDERED },
      data: { status: PurchaseOrderStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (updated.count !== 1) throw new PurchaseError("La orden cambió mientras intentabas cancelarla. Recarga la pantalla.");
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function receivePurchaseOrder(input: ReceivePurchaseOrderInput): Promise<PurchaseReceipt> {
  const key = normalizeRequestKey(input.requestKey);
  const existing = await prisma.purchaseReceipt.findUnique({ where: { requestKey: key } });
  if (existing) return existing;

  const purchaseOrderId = input.purchaseOrderId.slice(0, 30);
  const receivedBy = required(input.receivedBy, "El responsable de recepción", 80);
  const supplierDocumentNumber = clean(input.supplierDocumentNumber, 100);
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) {
    throw new PurchaseError("Ingresa al menos una cantidad recibida.");
  }

  const normalizedItems = input.items
    .map((item) => ({
      purchaseOrderItemId: typeof item.purchaseOrderItemId === "string" ? item.purchaseOrderItemId.slice(0, 30) : "",
      quantity: roundQuantity(Number(item.quantity)),
      unitCostNet: item.unitCostNet == null ? undefined : Number(item.unitCostNet),
    }))
    .filter((item) => item.quantity > 0);
  if (normalizedItems.length === 0) throw new PurchaseError("Ingresa al menos una cantidad recibida mayor a cero.");
  if (new Set(normalizedItems.map((item) => item.purchaseOrderItemId)).size !== normalizedItems.length) {
    throw new PurchaseError("La recepción contiene líneas duplicadas.");
  }

  const number = receiptNumber();
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          supplier: true,
          warehouse: true,
          items: true,
        },
      });
      if (!order) throw new PurchaseError("Orden de compra no encontrada.");
      if (order.status === PurchaseOrderStatus.CANCELLED) throw new PurchaseError("La orden de compra está cancelada.");
      if (order.status === PurchaseOrderStatus.RECEIVED) throw new PurchaseError("La orden ya fue recibida completamente.");
      if (!order.warehouse.active) throw new PurchaseError("La bodega de recepción está inactiva.");

      const itemMap = new Map(order.items.map((item) => [item.id, item]));
      const lines = normalizedItems.map((line) => {
        const item = itemMap.get(line.purchaseOrderItemId);
        if (!item) throw new PurchaseError("La recepción contiene una línea que no pertenece a la orden.");
        const ordered = toQuantityNumber(item.orderedQuantity);
        const alreadyReceived = toQuantityNumber(item.receivedQuantity);
        const remaining = roundQuantity(ordered - alreadyReceived);
        if (!isValidQuantityForUnit(line.quantity, item.unit, { max: 10_000_000 }) || line.quantity > remaining) {
          throw new PurchaseError(`${item.productName}: máximo pendiente ${formatQuantity(remaining, item.unit)}.`);
        }
        const unitCostNet = line.unitCostNet ?? item.unitCostNet;
        if (!validMoney(unitCostNet)) throw new PurchaseError(`${item.productName}: el costo neto recibido no es válido.`);
        return {
          item,
          quantity: line.quantity,
          unitCostNet,
          netAmount: calculateQuantitySubtotal(unitCostNet, line.quantity),
        };
      });

      const receipt = await tx.purchaseReceipt.create({
        data: {
          receiptNumber: number,
          requestKey: key,
          purchaseOrderId: order.id,
          documentType: input.documentType ?? null,
          supplierDocumentNumber,
          receivedBy,
          notes: clean(input.notes, 1000),
          items: {
            create: lines.map((line) => ({
              purchaseOrderItemId: line.item.id,
              productId: line.item.productId,
              productName: line.item.productName,
              unit: line.item.unit,
              quantity: line.quantity,
              unitCostNet: line.unitCostNet,
              netAmount: line.netAmount,
            })),
          },
        },
      });

      for (const line of lines) {
        const changed = await tx.purchaseOrderItem.updateMany({
          where: { id: line.item.id, receivedQuantity: line.item.receivedQuantity },
          data: { receivedQuantity: { increment: line.quantity } },
        });
        if (changed.count !== 1) throw new PurchaseError("La orden cambió durante la recepción. Recarga e intenta nuevamente.");

        const stock = await tx.inventoryStock.upsert({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: line.item.productId } },
          create: {
            warehouseId: order.warehouseId,
            productId: line.item.productId,
            onHand: line.quantity,
            reserved: 0,
            minStock: 0,
          },
          update: { onHand: { increment: line.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            warehouseId: order.warehouseId,
            productId: line.item.productId,
            type: InventoryMovementType.RECEIVE,
            quantity: line.quantity,
            onHandAfter: stock.onHand,
            reservedAfter: stock.reserved,
            reference: receipt.receiptNumber,
            note: `Recepción ${receipt.receiptNumber} · ${order.orderNumber} · ${order.supplier.name}${supplierDocumentNumber ? ` · doc. ${supplierDocumentNumber}` : ""}`,
          },
        });
        await syncProductInventory(tx, line.item.productId);
      }

      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: order.id },
        select: { orderedQuantity: true, receivedQuantity: true },
      });
      const complete = refreshedItems.every((item) =>
        toQuantityNumber(item.receivedQuantity) >= toQuantityNumber(item.orderedQuantity),
      );
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          completedAt: complete ? new Date() : null,
        },
      });

      return receipt;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isUniqueError(error)) {
      const duplicate = await prisma.purchaseReceipt.findUnique({ where: { requestKey: key } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

export function parsePurchaseReceiptDocumentType(value: string): PurchaseReceiptDocumentType | null {
  if (value === PurchaseReceiptDocumentType.GUIA_DESPACHO) return PurchaseReceiptDocumentType.GUIA_DESPACHO;
  if (value === PurchaseReceiptDocumentType.FACTURA) return PurchaseReceiptDocumentType.FACTURA;
  if (value === PurchaseReceiptDocumentType.BOLETA) return PurchaseReceiptDocumentType.BOLETA;
  if (value === PurchaseReceiptDocumentType.OTRO) return PurchaseReceiptDocumentType.OTRO;
  return null;
}
