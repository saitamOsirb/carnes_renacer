import "server-only";

import { randomUUID } from "node:crypto";
import { InventoryMovementType, LotMovementType, PosPaymentMethod, PosShiftStatus, Prisma, type PosSale } from "@prisma/client";
import { syncProductInventory } from "@/lib/inventory-service";
import { consumeLotsFefo } from "@/lib/lot-service";
import { prisma } from "@/lib/prisma";
import {
  calculateQuantitySubtotal,
  formatQuantity,
  isValidQuantityForUnit,
  roundQuantity,
  toQuantityNumber,
} from "@/lib/quantity";
import { reconcileWarehouseLocationStock } from "@/lib/warehouse-location-service";

export type PosSaleLineInput = { productId: string; quantity: number };

export type CreatePosSaleInput = {
  shiftId: string;
  items: PosSaleLineInput[];
  discount: number;
  paymentMethod: PosPaymentMethod;
  amountReceived?: number | null;
  customerId?: string;
  notes?: string;
};

export class PosSaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosSaleError";
  }
}

function saleNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `POS-${date}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function cleanOptional(value: string | undefined, max: number): string | null {
  const normalized = value?.trim().slice(0, max) ?? "";
  return normalized || null;
}

export async function createPosSale(input: CreatePosSaleInput): Promise<PosSale> {
  if (!input.shiftId) throw new PosSaleError("Debes operar sobre un turno de caja abierto.");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new PosSaleError("Agrega al menos un producto al carrito.");
  if (input.items.length > 100) throw new PosSaleError("La venta supera el máximo de 100 líneas.");

  const normalizedItems = input.items.map((item) => ({
    productId: typeof item.productId === "string" ? item.productId.slice(0, 30) : "",
    quantity: roundQuantity(Number(item.quantity)),
  }));
  if (normalizedItems.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100_000)) throw new PosSaleError("El carrito contiene cantidades inválidas.");

  const productIds = normalizedItems.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) throw new PosSaleError("El carrito contiene productos repetidos.");
  if (!Number.isInteger(input.discount) || input.discount < 0 || input.discount > 999_999_999) throw new PosSaleError("El descuento es inválido.");

  try {
    return await prisma.$transaction(async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: input.shiftId }, include: { register: { include: { warehouse: true } }, user: true } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new PosSaleError("El turno de caja está cerrado o no existe.");
      if (!shift.register.active || !shift.register.warehouse.active) throw new PosSaleError("La caja o su bodega ya no están activas.");
      if (!shift.user.active) throw new PosSaleError("El cajero ya no está activo.");

      const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId.slice(0, 30) } }) : null;
      if (input.customerId && (!customer || !customer.active || customer.anonymizedAt)) throw new PosSaleError("El cliente seleccionado ya no está disponible para nuevas ventas.");
      if (customer && !customer.privacyAcknowledgedAt) throw new PosSaleError("El cliente seleccionado no tiene registrado el aviso de privacidad vigente.");

      const warehouseId = shift.register.warehouseId;
      const warehouse = shift.register.warehouse;
      const products = await tx.product.findMany({ where: { id: { in: productIds }, active: true }, select: { id: true, name: true, unit: true, price: true } });
      if (products.length !== productIds.length) throw new PosSaleError("Uno o más productos ya no están disponibles.");
      const stocks = await tx.inventoryStock.findMany({ where: { warehouseId, productId: { in: productIds } } });
      const productMap = new Map(products.map((product) => [product.id, product]));
      const stockMap = new Map(stocks.map((stock) => [stock.productId, stock]));

      const lines = normalizedItems.map((item) => {
        const product = productMap.get(item.productId);
        if (!product) throw new PosSaleError("Producto inválido en el carrito.");
        if (!isValidQuantityForUnit(item.quantity, product.unit)) throw new PosSaleError(product.unit === "KG" ? `${product.name}: ingresa un peso válido con hasta tres decimales.` : `${product.name}: los productos por unidad solo admiten cantidades enteras.`);
        const stock = stockMap.get(item.productId);
        const onHand = stock ? toQuantityNumber(stock.onHand) : 0;
        const reserved = stock ? toQuantityNumber(stock.reserved) : 0;
        const available = roundQuantity(Math.max(0, onHand - reserved));
        if (!stock || available < item.quantity) throw new PosSaleError(`Stock insuficiente de ${product.name} en ${warehouse.name}. Disponible: ${formatQuantity(available, product.unit)}.`);
        const lineSubtotal = calculateQuantitySubtotal(product.price, item.quantity);
        if (!Number.isSafeInteger(lineSubtotal) || lineSubtotal <= 0) throw new PosSaleError(`Subtotal inválido para ${product.name}.`);
        return { product, stock, onHand, reserved, quantity: item.quantity, subtotal: lineSubtotal };
      });

      const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
      if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new PosSaleError("El total de la venta es inválido.");
      if (input.discount > subtotal) throw new PosSaleError("El descuento no puede superar el subtotal.");
      const total = subtotal - input.discount;
      let amountReceived: number | null = null;
      let changeDue = 0;
      if (input.paymentMethod === PosPaymentMethod.CASH) {
        const received = Number(input.amountReceived);
        if (!Number.isInteger(received) || received < total || received > 999_999_999) throw new PosSaleError("En efectivo, el monto recibido debe ser igual o mayor al total.");
        amountReceived = received;
        changeDue = received - total;
      }

      const number = saleNumber();
      const sale = await tx.posSale.create({
        data: {
          saleNumber: number,
          warehouseId,
          shiftId: shift.id,
          cashierId: shift.user.id,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          customerRut: customer?.rut ?? null,
          subtotal,
          discount: input.discount,
          total,
          paymentMethod: input.paymentMethod,
          amountReceived,
          changeDue,
          notes: cleanOptional(input.notes, 500),
          cashier: shift.user.name.slice(0, 80),
          items: { create: lines.map((line) => ({ productId: line.product.id, productName: line.product.name, unit: line.product.unit, quantity: line.quantity, unitPrice: line.product.price, subtotal: line.subtotal })) },
        },
        include: { items: true },
      });
      const saleItemByProduct = new Map(sale.items.map((item) => [item.productId, item]));

      for (const line of lines) {
        const saleItem = saleItemByProduct.get(line.product.id);
        if (!saleItem) throw new PosSaleError("No fue posible relacionar la línea de venta con su trazabilidad de lote.");
        const allocations = await consumeLotsFefo(tx, warehouseId, line.product.id, line.quantity, {
          type: LotMovementType.SALE,
          reference: number,
          note: `Venta POS ${number} · ${shift.register.name} · ${shift.user.name}`,
          aggregateOnHandBefore: line.stock.onHand,
        });
        if (allocations.length > 0) {
          await tx.posSaleLotAllocation.createMany({ data: allocations.map((allocation) => ({ saleItemId: saleItem.id, lotId: allocation.lotId, warehouseId, quantity: allocation.quantity })) });
        }

        const onHandAfter = roundQuantity(line.onHand - line.quantity);
        const updated = await tx.inventoryStock.updateMany({ where: { id: line.stock.id, onHand: line.stock.onHand, reserved: line.stock.reserved }, data: { onHand: { decrement: line.quantity } } });
        if (updated.count !== 1) throw new PosSaleError("El inventario cambió mientras se registraba la venta. Vuelve a intentarlo.");
        await tx.inventoryMovement.create({ data: { warehouseId, productId: line.product.id, type: InventoryMovementType.SALE, quantity: -line.quantity, onHandAfter, reservedAfter: line.reserved, note: `Venta POS ${number} · ${shift.register.name} · ${shift.user.name}`, reference: number } });
        await reconcileWarehouseLocationStock(tx, warehouseId, line.product.id, onHandAfter, { reference: number, note: `Salida automática de ubicación por venta POS ${number}`, actor: shift.user.username });
        await syncProductInventory(tx, line.product.id);
      }
      return sale;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "LOT_STOCK_NOT_AVAILABLE") throw new PosSaleError("La trazabilidad por lote no cubre el stock físico disponible. Revisa el módulo de lotes antes de vender.");
    throw error;
  }
}
