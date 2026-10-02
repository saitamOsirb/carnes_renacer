import "server-only";

import { randomUUID } from "node:crypto";
import {
  InventoryMovementType,
  PosCashMovementType,
  PosPaymentMethod,
  PosShiftStatus,
  Prisma,
  type PosReturn,
} from "@prisma/client";
import { syncProductInventory } from "@/lib/inventory-service";
import { restoreLotAllocations, restoreUntrackedLot, type LotAllocation } from "@/lib/lot-service";
import { prisma } from "@/lib/prisma";
import { calculateQuantitySubtotal, isValidQuantityForUnit, roundQuantity, toQuantityNumber } from "@/lib/quantity";

export type PosReturnLineInput = { saleItemId: string; quantity: number };
export type CreatePosReturnInput = { saleId: string; shiftId: string; requestKey: string; reason: string; items: PosReturnLineInput[] };

export class PosReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosReturnError";
  }
}

function returnNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `DEV-${date}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function distributeDiscount<T extends { grossAmount: number }>(lines: T[], discount: number): Array<T & { discountAmount: number; totalAmount: number }> {
  if (discount <= 0) return lines.map((line) => ({ ...line, discountAmount: 0, totalAmount: line.grossAmount }));
  const grossTotal = lines.reduce((sum, line) => sum + line.grossAmount, 0);
  let remaining = discount;
  return lines.map((line, index) => {
    const allocated = index === lines.length - 1 ? remaining : Math.min(remaining, Math.round(discount * line.grossAmount / grossTotal));
    remaining -= allocated;
    return { ...line, discountAmount: allocated, totalAmount: line.grossAmount - allocated };
  });
}

export async function createPosReturn(input: CreatePosReturnInput): Promise<PosReturn> {
  const saleId = input.saleId.trim().slice(0, 30);
  const shiftId = input.shiftId.trim().slice(0, 30);
  const requestKey = input.requestKey.trim().slice(0, 64);
  const reason = input.reason.trim().slice(0, 500);
  if (!saleId) throw new PosReturnError("Venta inválida.");
  if (!shiftId) throw new PosReturnError("Selecciona un turno de caja abierto para procesar la devolución.");
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(requestKey)) throw new PosReturnError("Identificador de devolución inválido. Recarga la venta e intenta nuevamente.");
  if (reason.length < 3) throw new PosReturnError("Indica el motivo de la devolución.");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new PosReturnError("Selecciona al menos un producto para devolver.");
  if (input.items.length > 100) throw new PosReturnError("La devolución supera el máximo de 100 líneas.");

  const existing = await prisma.posReturn.findUnique({ where: { requestKey } });
  if (existing) return existing;
  const normalizedItems = input.items.map((item) => ({ saleItemId: typeof item.saleItemId === "string" ? item.saleItemId.slice(0, 30) : "", quantity: roundQuantity(Number(item.quantity)) }));
  if (normalizedItems.some((item) => !item.saleItemId || !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new PosReturnError("La devolución contiene cantidades inválidas.");
  if (new Set(normalizedItems.map((item) => item.saleItemId)).size !== normalizedItems.length) throw new PosReturnError("La devolución contiene líneas repetidas.");

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.posReturn.findUnique({ where: { requestKey } });
      if (duplicate) return duplicate;

      const sale = await tx.posSale.findUnique({
        where: { id: saleId },
        include: {
          warehouse: true,
          items: { include: { lotAllocations: true, returnItems: { include: { lotAllocations: true } } } },
          returns: { select: { discountAmount: true, totalAmount: true } },
        },
      });
      if (!sale) throw new PosReturnError("Venta POS no encontrada.");
      const shift = await tx.posShift.findUnique({ where: { id: shiftId }, include: { register: true, user: true } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new PosReturnError("El turno seleccionado ya no está abierto.");
      if (!shift.user.active || !shift.register.active) throw new PosReturnError("El cajero o la caja del turno ya no están activos.");
      if (shift.register.warehouseId !== sale.warehouseId) throw new PosReturnError(`La devolución debe procesarse desde una caja asociada a ${sale.warehouse.name}.`);

      const itemById = new Map(sale.items.map((item) => [item.id, item]));
      const requestedById = new Map(normalizedItems.map((item) => [item.saleItemId, item.quantity]));
      const lines = normalizedItems.map((requested) => {
        const item = itemById.get(requested.saleItemId);
        if (!item) throw new PosReturnError("Una de las líneas no pertenece a la venta seleccionada.");
        if (!isValidQuantityForUnit(requested.quantity, item.unit)) throw new PosReturnError(`${item.productName}: cantidad de devolución inválida.`);
        const returnedQuantity = roundQuantity(item.returnItems.reduce((sum, returned) => sum + toQuantityNumber(returned.quantity), 0));
        const remainingQuantity = roundQuantity(toQuantityNumber(item.quantity) - returnedQuantity);
        if (requested.quantity > remainingQuantity + 1e-9) throw new PosReturnError(`${item.productName}: solo quedan ${remainingQuantity} por devolver.`);
        const previousGross = item.returnItems.reduce((sum, returned) => sum + returned.grossAmount, 0);
        const remainingGross = Math.max(0, item.subtotal - previousGross);
        const finalQuantity = Math.abs(requested.quantity - remainingQuantity) < 1e-9;
        const grossAmount = finalQuantity ? remainingGross : Math.min(remainingGross, calculateQuantitySubtotal(item.unitPrice, requested.quantity));
        if (!Number.isSafeInteger(grossAmount) || grossAmount <= 0) throw new PosReturnError(`${item.productName}: el monto de devolución calculado no es válido.`);
        return { saleItemId: item.id, productId: item.productId, productName: item.productName, unit: item.unit, unitPrice: item.unitPrice, quantity: requested.quantity, grossAmount };
      });

      const allReturnedAfter = sale.items.every((item) => {
        const returnedBefore = roundQuantity(item.returnItems.reduce((sum, returned) => sum + toQuantityNumber(returned.quantity), 0));
        return Math.abs(roundQuantity(returnedBefore + (requestedById.get(item.id) ?? 0)) - toQuantityNumber(item.quantity)) < 1e-9;
      });
      const grossAmount = lines.reduce((sum, line) => sum + line.grossAmount, 0);
      const previousDiscount = sale.returns.reduce((sum, item) => sum + item.discountAmount, 0);
      const previousRefunded = sale.returns.reduce((sum, item) => sum + item.totalAmount, 0);
      const remainingDiscount = Math.max(0, sale.discount - previousDiscount);
      const remainingPaid = Math.max(0, sale.total - previousRefunded);
      let discountAmount = sale.subtotal > 0 ? Math.min(remainingDiscount, Math.round(grossAmount * sale.discount / sale.subtotal)) : 0;
      let totalAmount = grossAmount - discountAmount;
      if (allReturnedAfter) { totalAmount = remainingPaid; discountAmount = grossAmount - totalAmount; }
      if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0 || totalAmount > remainingPaid) throw new PosReturnError("El monto total a reembolsar no es consistente con la venta original.");

      const pricedLines = distributeDiscount(lines, discountAmount);
      const number = returnNumber();
      const created = await tx.posReturn.create({
        data: {
          returnNumber: number,
          requestKey,
          saleId: sale.id,
          warehouseId: sale.warehouseId,
          shiftId: shift.id,
          refundMethod: sale.paymentMethod,
          grossAmount,
          discountAmount,
          totalAmount,
          reason,
          items: { create: pricedLines.map((line) => ({ saleItemId: line.saleItemId, productId: line.productId, productName: line.productName, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, grossAmount: line.grossAmount, discountAmount: line.discountAmount, totalAmount: line.totalAmount })) },
        },
        include: { items: true },
      });
      const createdItemBySaleItem = new Map(created.items.map((item) => [item.saleItemId, item]));

      for (const line of pricedLines) {
        const saleItem = itemById.get(line.saleItemId);
        const returnItem = createdItemBySaleItem.get(line.saleItemId);
        if (!saleItem || !returnItem) throw new PosReturnError("No fue posible reconstruir la trazabilidad de la devolución.");

        let remainingToRestore = line.quantity;
        const restored: LotAllocation[] = [];
        if (saleItem.lotAllocations.length > 0) {
          const alreadyReturnedByLot = new Map<string, number>();
          for (const previousReturn of saleItem.returnItems) {
            for (const allocation of previousReturn.lotAllocations) alreadyReturnedByLot.set(allocation.lotId, roundQuantity((alreadyReturnedByLot.get(allocation.lotId) ?? 0) + toQuantityNumber(allocation.quantity)));
          }
          for (const original of saleItem.lotAllocations) {
            if (remainingToRestore <= 0) break;
            const available = roundQuantity(Math.max(0, toQuantityNumber(original.quantity) - (alreadyReturnedByLot.get(original.lotId) ?? 0)));
            const take = roundQuantity(Math.min(available, remainingToRestore));
            if (take > 0) { restored.push({ lotId: original.lotId, quantity: take }); remainingToRestore = roundQuantity(remainingToRestore - take); }
          }
        }
        if (restored.length > 0) await restoreLotAllocations(tx, sale.warehouseId, restored, { reference: number, note: `Devolución ${number} de venta ${sale.saleNumber}` });
        if (remainingToRestore > 0) restored.push(await restoreUntrackedLot(tx, sale.warehouseId, line.productId, remainingToRestore, { reference: number, note: `Devolución histórica ${number} sin lote original identificable` }));
        await tx.posReturnLotAllocation.createMany({ data: restored.map((allocation) => ({ returnItemId: returnItem.id, lotId: allocation.lotId, warehouseId: sale.warehouseId, quantity: allocation.quantity })) });

        const stock = await tx.inventoryStock.findUnique({ where: { warehouseId_productId: { warehouseId: sale.warehouseId, productId: line.productId } } });
        let onHandAfter: number;
        let reservedAfter: number;
        if (stock) {
          const onHand = toQuantityNumber(stock.onHand);
          reservedAfter = toQuantityNumber(stock.reserved);
          onHandAfter = roundQuantity(onHand + line.quantity);
          const updated = await tx.inventoryStock.updateMany({ where: { id: stock.id, onHand: stock.onHand, reserved: stock.reserved }, data: { onHand: { increment: line.quantity } } });
          if (updated.count !== 1) throw new PosReturnError("El inventario cambió mientras se procesaba la devolución. Intenta nuevamente.");
        } else {
          onHandAfter = line.quantity;
          reservedAfter = 0;
          await tx.inventoryStock.create({ data: { warehouseId: sale.warehouseId, productId: line.productId, onHand: line.quantity, reserved: 0, minStock: 0 } });
        }
        await tx.inventoryMovement.create({ data: { warehouseId: sale.warehouseId, productId: line.productId, type: InventoryMovementType.RETURN, quantity: line.quantity, onHandAfter, reservedAfter, note: `Devolución POS ${number} · venta ${sale.saleNumber} · ${shift.register.name} · ${shift.user.name}`, reference: number } });
        await syncProductInventory(tx, line.productId);
      }

      if (sale.paymentMethod === PosPaymentMethod.CASH) {
        const cashMovement = await tx.posCashMovement.create({ data: { shiftId: shift.id, type: PosCashMovementType.CASH_OUT, amount: totalAmount, reason: `Reembolso ${number} de venta ${sale.saleNumber}: ${reason}`.slice(0, 500) } });
        return tx.posReturn.update({ where: { id: created.id }, data: { cashMovementId: cashMovement.id } });
      }
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PosReturnError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.posReturn.findUnique({ where: { requestKey } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}
