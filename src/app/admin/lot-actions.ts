"use server";

import { Prisma, WarehouseLocationMovementType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isValidQuantityForUnit, roundQuantity, toQuantityNumber } from "@/lib/quantity";
import { getLocatedWarehouseQuantity } from "@/lib/warehouse-location-service";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function quantity(formData: FormData): number | null {
  const value = Number(text(formData, "quantity", 30).replace(",", "."));
  const rounded = roundQuantity(value);
  return Number.isFinite(value) && rounded > 0 && Math.abs(value - rounded) < 1e-9 ? rounded : null;
}

function normalizeLocationCode(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9._/-]/g, "").slice(0, 80);
}

function lotsUrl(type: "ok" | "error", message: string, warehouseId = ""): string {
  const params = new URLSearchParams({ [type]: message });
  if (warehouseId) params.set("warehouseId", warehouseId);
  return `/admin/lotes?${params.toString()}`;
}

function refresh(): void {
  revalidatePath("/admin/lotes");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
}

export async function assignLotPlacementAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const lotId = text(formData, "lotId", 30);
  const objectId = text(formData, "objectId", 30);
  const locationCode = normalizeLocationCode(text(formData, "locationCode", 80));
  const value = quantity(formData);
  if (!warehouseId || !lotId || !objectId || value === null) redirect(lotsUrl("error", "Ubicación de lote inválida.", warehouseId));

  try {
    await prisma.$transaction(async (tx) => {
      const lotStock = await tx.inventoryLotStock.findUnique({
        where: { lotId_warehouseId: { lotId, warehouseId } },
        include: { lot: { include: { product: { select: { id: true, name: true, unit: true } } } } },
      });
      const object = await tx.warehouseVisualObject.findFirst({ where: { id: objectId, layout: { warehouseId } }, select: { id: true, label: true } });
      const inventoryStock = lotStock ? await tx.inventoryStock.findUnique({ where: { warehouseId_productId: { warehouseId, productId: lotStock.lot.productId } } }) : null;
      if (!lotStock || !object || !inventoryStock) throw new Error("NOT_FOUND");
      if (!isValidQuantityForUnit(value, lotStock.lot.product.unit, { max: 10_000_000 })) throw new Error("INVALID_QUANTITY");

      const lotPlaced = await tx.warehouseLotPlacement.aggregate({ where: { warehouseId, lotId }, _sum: { quantity: true } });
      const lotUnlocated = roundQuantity(toQuantityNumber(lotStock.onHand) - toQuantityNumber(lotPlaced._sum.quantity ?? 0));
      if (value > lotUnlocated + 1e-9) throw new Error("LOT_OVER_ALLOCATE");

      const currentDetailedAtLocation = await tx.warehouseLotPlacement.aggregate({ where: { warehouseId, objectId, locationCode, lot: { productId: lotStock.lot.productId } }, _sum: { quantity: true } });
      const aggregatePlacement = await tx.warehouseProductPlacement.findFirst({ where: { warehouseId, productId: lotStock.lot.productId, objectId, locationCode } });
      const aggregateAtLocation = aggregatePlacement ? toQuantityNumber(aggregatePlacement.quantity) : 0;
      const desiredDetailed = roundQuantity(toQuantityNumber(currentDetailedAtLocation._sum.quantity ?? 0) + value);
      const aggregateIncrease = roundQuantity(Math.max(0, desiredDetailed - aggregateAtLocation));

      if (aggregateIncrease > 0) {
        const located = await getLocatedWarehouseQuantity(tx, warehouseId, lotStock.lot.productId);
        const unlocatedProduct = roundQuantity(toQuantityNumber(inventoryStock.onHand) - located);
        if (aggregateIncrease > unlocatedProduct + 1e-9) throw new Error("PRODUCT_OVER_ALLOCATE");
        if (aggregatePlacement) await tx.warehouseProductPlacement.update({ where: { id: aggregatePlacement.id }, data: { quantity: { increment: aggregateIncrease } } });
        else await tx.warehouseProductPlacement.create({ data: { warehouseId, productId: lotStock.lot.productId, objectId, locationCode, quantity: aggregateIncrease } });
        await tx.warehouseLocationMovement.create({ data: { warehouseId, productId: lotStock.lot.productId, type: WarehouseLocationMovementType.ALLOCATE, quantity: aggregateIncrease, locatedAfter: roundQuantity(located + aggregateIncrease), toObjectId: object.id, toObjectLabel: object.label, toLocationCode: locationCode || null, reference: `LOT-${lotStock.lot.internalCode}`, note: "Ubicación física detallada por lote", actor: (process.env.ADMIN_USERNAME?.trim() || "admin").slice(0, 80) } });
      }

      const existing = await tx.warehouseLotPlacement.findFirst({ where: { warehouseId, objectId, lotId, locationCode } });
      if (existing) await tx.warehouseLotPlacement.update({ where: { id: existing.id }, data: { quantity: { increment: value } } });
      else await tx.warehouseLotPlacement.create({ data: { warehouseId, objectId, lotId, locationCode, quantity: value } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "LOT_OVER_ALLOCATE") redirect(lotsUrl("error", "La cantidad supera el saldo del lote que queda sin ubicar.", warehouseId));
    if (error instanceof Error && error.message === "PRODUCT_OVER_ALLOCATE") redirect(lotsUrl("error", "La ubicación agregada supera el stock físico global sin ubicar del producto.", warehouseId));
    if (error instanceof Error && error.message === "INVALID_QUANTITY") redirect(lotsUrl("error", "Cantidad inválida para la unidad del producto.", warehouseId));
    if (error instanceof Error && error.message === "NOT_FOUND") redirect(lotsUrl("error", "Lote, stock o ubicación WMS no encontrados.", warehouseId));
    throw error;
  }

  refresh();
  redirect(lotsUrl("ok", "Lote ubicado físicamente en el WMS.", warehouseId));
}

export async function removeLotPlacementAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const placementId = text(formData, "placementId", 30);
  const warehouseId = text(formData, "warehouseId", 30);
  if (!placementId || !warehouseId) redirect(lotsUrl("error", "Ubicación de lote inválida.", warehouseId));

  await prisma.$transaction(async (tx) => {
    const placement = await tx.warehouseLotPlacement.findUnique({ where: { id: placementId }, include: { lot: true } });
    if (!placement || placement.warehouseId !== warehouseId) throw new Error("LOT_PLACEMENT_NOT_FOUND");
    const productPlacement = await tx.warehouseProductPlacement.findFirst({ where: { warehouseId, productId: placement.lot.productId, objectId: placement.objectId, locationCode: placement.locationCode } });
    await tx.warehouseLotPlacement.delete({ where: { id: placement.id } });

    if (productPlacement) {
      const remainingDetail = await tx.warehouseLotPlacement.aggregate({ where: { warehouseId, objectId: placement.objectId, locationCode: placement.locationCode, lot: { productId: placement.lot.productId } }, _sum: { quantity: true } });
      const currentAggregate = toQuantityNumber(productPlacement.quantity);
      const desiredAggregate = Math.max(toQuantityNumber(remainingDetail._sum.quantity ?? 0), roundQuantity(currentAggregate - toQuantityNumber(placement.quantity)));
      if (desiredAggregate <= 0) await tx.warehouseProductPlacement.delete({ where: { id: productPlacement.id } });
      else await tx.warehouseProductPlacement.update({ where: { id: productPlacement.id }, data: { quantity: desiredAggregate } });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  refresh();
  redirect(lotsUrl("ok", "Lote desubicado. El stock físico sigue disponible en la bodega.", warehouseId));
}
