"use server";

import { Prisma, WarehouseLocationMovementType, WarehouseVisualObjectType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  formatQuantity,
  isValidQuantityForUnit,
  roundQuantity,
  toQuantityNumber,
} from "@/lib/quantity";
import { getLocatedWarehouseQuantity } from "@/lib/warehouse-location-service";

const MAX_OBJECTS = 180;
const VALID_TYPES = new Set(Object.values(WarehouseVisualObjectType));

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function decimalQuantity(formData: FormData, key: string, min = 0, max = 10_000_000): number | null {
  const raw = text(formData, key, 30).replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  const rounded = roundQuantity(value);
  if (!Number.isFinite(value) || Math.abs(value - rounded) > 1e-9 || rounded < min || rounded > max) return null;
  return rounded;
}

function metersToCm(formData: FormData, key: string, minCm: number, maxCm: number): number | null {
  const raw = text(formData, key, 30).replace(",", ".");
  if (!raw) return null;
  const meters = Number(raw);
  if (!Number.isFinite(meters)) return null;
  const cm = Math.round(meters * 100);
  return cm >= minCm && cm <= maxCm ? cm : null;
}

function normalizeLocationCode(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9._/-]/g, "")
    .slice(0, 80);
}

function actorName(): string {
  return (process.env.ADMIN_USERNAME?.trim() || "admin").slice(0, 80);
}

function mapUrl(warehouseId: string, type: "ok" | "error", message: string): string {
  const params = new URLSearchParams({ warehouseId, [type]: message });
  return `/admin/inventario/mapa?${params.toString()}`;
}

function refreshWarehouseMap(): void {
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
}

type SceneObjectInput = {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  xCm?: unknown;
  zCm?: unknown;
  widthCm?: unknown;
  depthCm?: unknown;
  heightCm?: unknown;
  rotation?: unknown;
};

type NormalizedSceneObject = {
  id: string;
  type: WarehouseVisualObjectType;
  label: string;
  xCm: number;
  zCm: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  rotation: number;
};

function parseScene(raw: string): SceneObjectInput[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SceneObjectInput[]) : null;
  } catch {
    return null;
  }
}

function normalizeSceneObject(candidate: SceneObjectInput): NormalizedSceneObject | null {
  const id = typeof candidate.id === "string" ? candidate.id.slice(0, 80) : "";
  const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 120) : "";
  const typeRaw = typeof candidate.type === "string" ? candidate.type : "";
  const xCm = Number(candidate.xCm);
  const zCm = Number(candidate.zCm);
  const widthCm = Number(candidate.widthCm);
  const depthCm = Number(candidate.depthCm);
  const heightCm = Number(candidate.heightCm);
  const rotation = Number(candidate.rotation);

  if (!VALID_TYPES.has(typeRaw as WarehouseVisualObjectType) || label.length < 1) return null;
  if (![xCm, zCm, widthCm, depthCm, heightCm, rotation].every(Number.isInteger)) return null;
  if (xCm < 0 || zCm < 0 || widthCm < 10 || depthCm < 10 || heightCm < 5) return null;
  if (widthCm > 20_000 || depthCm > 20_000 || heightCm > 5_000) return null;
  if (![0, 90, 180, 270].includes(rotation)) return null;

  return { id, type: typeRaw as WarehouseVisualObjectType, label, xCm, zCm, widthCm, depthCm, heightCm, rotation };
}

export async function saveWarehouseDimensions(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const widthCm = metersToCm(formData, "widthM", 100, 50_000);
  const depthCm = metersToCm(formData, "depthM", 100, 50_000);
  const heightCm = metersToCm(formData, "heightM", 100, 10_000);

  if (!warehouseId || widthCm === null || depthCm === null || heightCm === null) {
    redirect(mapUrl(warehouseId, "error", "Ingresa dimensiones válidas para la bodega."));
  }

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, name: true } });
  if (!warehouse) redirect(mapUrl(warehouseId, "error", "Bodega no encontrada."));

  const existing = await prisma.warehouseLayout.findUnique({ where: { warehouseId }, include: { objects: true } });
  if (existing) {
    const outside = existing.objects.find((object) => object.xCm + object.widthCm > widthCm || object.zCm + object.depthCm > depthCm || object.heightCm > heightCm);
    if (outside) redirect(mapUrl(warehouseId, "error", `El objeto ${outside.label} quedaría fuera de las nuevas dimensiones.`));
  }

  await prisma.warehouseLayout.upsert({
    where: { warehouseId },
    update: { widthCm, depthCm, heightCm },
    create: { warehouseId, widthCm, depthCm, heightCm },
  });

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", `Dimensiones de ${warehouse.name} guardadas.`));
}

export async function saveWarehouseScene(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const rawScene = text(formData, "scene", 250_000);
  const parsed = parseScene(rawScene);

  if (!warehouseId || !parsed || parsed.length > MAX_OBJECTS) {
    redirect(mapUrl(warehouseId, "error", `El plano es inválido o supera ${MAX_OBJECTS} objetos.`));
  }

  const normalized = parsed.map(normalizeSceneObject);
  if (normalized.some((item) => item === null)) redirect(mapUrl(warehouseId, "error", "Uno o más objetos tienen medidas o datos inválidos."));
  const objects = normalized as NormalizedSceneObject[];

  const layout = await prisma.warehouseLayout.findUnique({
    where: { warehouseId },
    include: { objects: { include: { placements: true } } },
  });
  if (!layout) redirect(mapUrl(warehouseId, "error", "Primero configura las dimensiones de la bodega."));

  const outside = objects.find((object) =>
    object.xCm + object.widthCm > layout.widthCm ||
    object.zCm + object.depthCm > layout.depthCm ||
    object.heightCm > layout.heightCm,
  );
  if (outside) redirect(mapUrl(warehouseId, "error", `${outside.label} está fuera de los límites de la bodega.`));

  const existingIds = new Set(layout.objects.map((object) => object.id));
  const retainedIds = objects.filter((object) => existingIds.has(object.id)).map((object) => object.id);
  const retainedSet = new Set(retainedIds);
  const removedObjects = layout.objects.filter((object) => !retainedSet.has(object.id));

  await prisma.$transaction(async (tx) => {
    if (removedObjects.length > 0) {
      const affectedProducts = [...new Set(removedObjects.flatMap((object) => object.placements.map((placement) => placement.productId)))];
      const runningLocated = new Map<string, number>();
      for (const productId of affectedProducts) {
        runningLocated.set(productId, await getLocatedWarehouseQuantity(tx, warehouseId, productId));
      }

      for (const object of removedObjects) {
        for (const placement of object.placements) {
          const placementQuantity = toQuantityNumber(placement.quantity);
          const locatedAfter = roundQuantity(Math.max(0, (runningLocated.get(placement.productId) ?? 0) - placementQuantity));
          runningLocated.set(placement.productId, locatedAfter);
          await tx.warehouseLocationMovement.create({
            data: {
              warehouseId,
              productId: placement.productId,
              type: WarehouseLocationMovementType.UNASSIGN,
              quantity: -placementQuantity,
              locatedAfter,
              fromObjectId: object.id,
              fromObjectLabel: object.label,
              fromLocationCode: placement.locationCode || null,
              reference: "MAP-OBJECT-DELETE",
              note: "Ubicación liberada al eliminar el objeto del plano",
              actor: actorName(),
            },
          });
        }
      }
    }

    await tx.warehouseVisualObject.deleteMany({
      where: { layoutId: layout.id, ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}) },
    });

    for (const object of objects) {
      const data = {
        type: object.type,
        label: object.label,
        xCm: object.xCm,
        zCm: object.zCm,
        widthCm: object.widthCm,
        depthCm: object.depthCm,
        heightCm: object.heightCm,
        rotation: object.rotation,
      };
      if (existingIds.has(object.id)) {
        await tx.warehouseVisualObject.update({ where: { id: object.id }, data });
      } else {
        await tx.warehouseVisualObject.create({ data: { layoutId: layout.id, ...data } });
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", "Plano virtual guardado correctamente."));
}

export async function assignWarehouseProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const productId = text(formData, "productId", 30);
  const objectId = text(formData, "objectId", 30);
  const locationCode = normalizeLocationCode(text(formData, "locationCode", 80));
  const quantity = decimalQuantity(formData, "quantity", 0.001);

  if (!warehouseId || !productId || !objectId || quantity === null) {
    redirect(mapUrl(warehouseId, "error", "Selecciona producto, ubicación y una cantidad válida."));
  }

  let message = "Stock ubicado correctamente.";
  try {
    message = await prisma.$transaction(async (tx) => {
      const [object, stock] = await Promise.all([
        tx.warehouseVisualObject.findFirst({
          where: { id: objectId, layout: { warehouseId } },
          select: { id: true, label: true },
        }),
        tx.inventoryStock.findUnique({
          where: { warehouseId_productId: { warehouseId, productId } },
          include: { product: { select: { name: true, unit: true } } },
        }),
      ]);
      if (!object) throw new Error("INVALID_LOCATION");
      if (!stock) throw new Error("MISSING_STOCK");
      if (!isValidQuantityForUnit(quantity, stock.product.unit, { max: 10_000_000 })) throw new Error("INVALID_QUANTITY");

      const located = await getLocatedWarehouseQuantity(tx, warehouseId, productId);
      const unlocated = roundQuantity(Math.max(0, toQuantityNumber(stock.onHand) - located));
      if (quantity > unlocated) throw new Error("OVER_ALLOCATE");

      const existing = await tx.warehouseProductPlacement.findFirst({ where: { warehouseId, productId, objectId, locationCode } });
      if (existing) {
        await tx.warehouseProductPlacement.update({ where: { id: existing.id }, data: { quantity: { increment: quantity } } });
      } else {
        await tx.warehouseProductPlacement.create({ data: { warehouseId, productId, objectId, locationCode, quantity } });
      }

      const locatedAfter = roundQuantity(located + quantity);
      await tx.warehouseLocationMovement.create({
        data: {
          warehouseId,
          productId,
          type: WarehouseLocationMovementType.ALLOCATE,
          quantity,
          locatedAfter,
          toObjectId: object.id,
          toObjectLabel: object.label,
          toLocationCode: locationCode || null,
          note: "Asignación manual de stock a ubicación física",
          actor: actorName(),
        },
      });

      return `${stock.product.name}: ${formatQuantity(quantity, stock.product.unit)} ubicados en ${object.label}${locationCode ? ` · ${locationCode}` : ""}.`;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_LOCATION") redirect(mapUrl(warehouseId, "error", "La ubicación seleccionada no pertenece a esta bodega."));
    if (error instanceof Error && error.message === "MISSING_STOCK") redirect(mapUrl(warehouseId, "error", "Ese producto todavía no tiene inventario en esta bodega."));
    if (error instanceof Error && error.message === "OVER_ALLOCATE") redirect(mapUrl(warehouseId, "error", "La cantidad supera el stock físico que queda sin ubicar."));
    if (error instanceof Error && error.message === "INVALID_QUANTITY") redirect(mapUrl(warehouseId, "error", "La cantidad no corresponde a la unidad de medida del producto."));
    throw error;
  }

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", message));
}

export async function moveWarehouseLocationStock(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const sourcePlacementId = text(formData, "sourcePlacementId", 30);
  const targetObjectId = text(formData, "targetObjectId", 30);
  const targetLocationCode = normalizeLocationCode(text(formData, "targetLocationCode", 80));
  const quantity = decimalQuantity(formData, "quantity", 0.001);
  const note = text(formData, "note", 500);

  if (!warehouseId || !sourcePlacementId || !targetObjectId || quantity === null) {
    redirect(mapUrl(warehouseId, "error", "Movimiento interno inválido."));
  }

  let message = "Movimiento interno registrado.";
  try {
    message = await prisma.$transaction(async (tx) => {
      const [source, targetObject] = await Promise.all([
        tx.warehouseProductPlacement.findUnique({
          where: { id: sourcePlacementId },
          include: { object: true, product: { select: { name: true, unit: true } } },
        }),
        tx.warehouseVisualObject.findFirst({
          where: { id: targetObjectId, layout: { warehouseId } },
          select: { id: true, label: true },
        }),
      ]);
      if (!source || source.warehouseId !== warehouseId) throw new Error("INVALID_SOURCE");
      if (!targetObject) throw new Error("INVALID_TARGET");
      if (!isValidQuantityForUnit(quantity, source.product.unit, { max: 10_000_000 })) throw new Error("INVALID_QUANTITY");

      const sourceQuantity = toQuantityNumber(source.quantity);
      if (quantity > sourceQuantity) throw new Error("INSUFFICIENT_LOCATION_STOCK");
      if (source.objectId === targetObject.id && source.locationCode === targetLocationCode) throw new Error("SAME_LOCATION");

      const located = await getLocatedWarehouseQuantity(tx, warehouseId, source.productId);
      const target = await tx.warehouseProductPlacement.findFirst({
        where: { warehouseId, productId: source.productId, objectId: targetObject.id, locationCode: targetLocationCode },
      });

      const remaining = roundQuantity(sourceQuantity - quantity);
      if (remaining <= 0) {
        await tx.warehouseProductPlacement.delete({ where: { id: source.id } });
      } else {
        await tx.warehouseProductPlacement.update({ where: { id: source.id }, data: { quantity: remaining } });
      }

      if (target) {
        await tx.warehouseProductPlacement.update({ where: { id: target.id }, data: { quantity: { increment: quantity } } });
      } else {
        await tx.warehouseProductPlacement.create({
          data: { warehouseId, productId: source.productId, objectId: targetObject.id, locationCode: targetLocationCode, quantity },
        });
      }

      await tx.warehouseLocationMovement.create({
        data: {
          warehouseId,
          productId: source.productId,
          type: WarehouseLocationMovementType.INTERNAL_TRANSFER,
          quantity,
          locatedAfter: located,
          fromObjectId: source.objectId,
          fromObjectLabel: source.object.label,
          fromLocationCode: source.locationCode || null,
          toObjectId: targetObject.id,
          toObjectLabel: targetObject.label,
          toLocationCode: targetLocationCode || null,
          note: note || "Transferencia interna entre ubicaciones",
          actor: actorName(),
        },
      });

      return `${source.product.name}: ${formatQuantity(quantity, source.product.unit)} movidos de ${source.object.label} a ${targetObject.label}.`;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_SOURCE") redirect(mapUrl(warehouseId, "error", "La ubicación de origen ya no existe."));
    if (error instanceof Error && error.message === "INVALID_TARGET") redirect(mapUrl(warehouseId, "error", "La ubicación de destino no pertenece a esta bodega."));
    if (error instanceof Error && error.message === "INSUFFICIENT_LOCATION_STOCK") redirect(mapUrl(warehouseId, "error", "La ubicación de origen no contiene esa cantidad."));
    if (error instanceof Error && error.message === "SAME_LOCATION") redirect(mapUrl(warehouseId, "error", "Origen y destino son la misma ubicación."));
    if (error instanceof Error && error.message === "INVALID_QUANTITY") redirect(mapUrl(warehouseId, "error", "La cantidad no corresponde a la unidad de medida del producto."));
    throw error;
  }

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", message));
}

export async function adjustWarehouseProductPlacementQuantity(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const placementId = text(formData, "placementId", 30);
  const newQuantity = decimalQuantity(formData, "newQuantity", 0);
  const note = text(formData, "note", 500);

  if (!warehouseId || !placementId || newQuantity === null) {
    redirect(mapUrl(warehouseId, "error", "Ajuste de ubicación inválido."));
  }

  let message = "Distribución actualizada.";
  try {
    message = await prisma.$transaction(async (tx) => {
      const placement = await tx.warehouseProductPlacement.findUnique({
        where: { id: placementId },
        include: { object: true, product: { select: { name: true, unit: true } } },
      });
      if (!placement || placement.warehouseId !== warehouseId) throw new Error("INVALID_PLACEMENT");
      if (!isValidQuantityForUnit(newQuantity, placement.product.unit, { allowZero: true, max: 10_000_000 })) throw new Error("INVALID_QUANTITY");

      const stock = await tx.inventoryStock.findUnique({
        where: { warehouseId_productId: { warehouseId, productId: placement.productId } },
      });
      if (!stock) throw new Error("MISSING_STOCK");

      const currentQuantity = toQuantityNumber(placement.quantity);
      const located = await getLocatedWarehouseQuantity(tx, warehouseId, placement.productId);
      const locatedWithoutCurrent = roundQuantity(located - currentQuantity);
      const locatedAfter = roundQuantity(locatedWithoutCurrent + newQuantity);
      if (locatedAfter > toQuantityNumber(stock.onHand)) throw new Error("OVER_ALLOCATE");

      const delta = roundQuantity(newQuantity - currentQuantity);
      if (newQuantity === 0) {
        await tx.warehouseProductPlacement.delete({ where: { id: placement.id } });
      } else {
        await tx.warehouseProductPlacement.update({ where: { id: placement.id }, data: { quantity: newQuantity } });
      }

      if (delta !== 0) {
        await tx.warehouseLocationMovement.create({
          data: {
            warehouseId,
            productId: placement.productId,
            type: WarehouseLocationMovementType.ADJUST,
            quantity: delta,
            locatedAfter,
            fromObjectId: placement.objectId,
            fromObjectLabel: placement.object.label,
            fromLocationCode: placement.locationCode || null,
            toObjectId: newQuantity > 0 ? placement.objectId : null,
            toObjectLabel: newQuantity > 0 ? placement.object.label : null,
            toLocationCode: newQuantity > 0 ? placement.locationCode || null : null,
            note: note || "Ajuste manual de distribución física",
            actor: actorName(),
          },
        });
      }

      return `${placement.product.name}: ubicación ajustada a ${formatQuantity(newQuantity, placement.product.unit)}.`;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PLACEMENT") redirect(mapUrl(warehouseId, "error", "La ubicación indicada ya no existe."));
    if (error instanceof Error && error.message === "MISSING_STOCK") redirect(mapUrl(warehouseId, "error", "No existe inventario para ese producto."));
    if (error instanceof Error && error.message === "OVER_ALLOCATE") redirect(mapUrl(warehouseId, "error", "El ajuste dejaría más stock ubicado que stock físico disponible."));
    if (error instanceof Error && error.message === "INVALID_QUANTITY") redirect(mapUrl(warehouseId, "error", "La cantidad no corresponde a la unidad de medida del producto."));
    throw error;
  }

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", message));
}

export async function removeWarehouseProductPlacement(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const placementId = text(formData, "placementId", 30);
  if (!warehouseId || !placementId) redirect(mapUrl(warehouseId, "error", "Ubicación de producto inválida."));

  try {
    await prisma.$transaction(async (tx) => {
      const placement = await tx.warehouseProductPlacement.findUnique({
        where: { id: placementId },
        include: { object: true },
      });
      if (!placement || placement.warehouseId !== warehouseId) throw new Error("INVALID_PLACEMENT");
      const located = await getLocatedWarehouseQuantity(tx, warehouseId, placement.productId);
      const placementQuantity = toQuantityNumber(placement.quantity);

      await tx.warehouseProductPlacement.delete({ where: { id: placement.id } });
      await tx.warehouseLocationMovement.create({
        data: {
          warehouseId,
          productId: placement.productId,
          type: WarehouseLocationMovementType.UNASSIGN,
          quantity: -placementQuantity,
          locatedAfter: roundQuantity(Math.max(0, located - placementQuantity)),
          fromObjectId: placement.objectId,
          fromObjectLabel: placement.object.label,
          fromLocationCode: placement.locationCode || null,
          note: "Stock devuelto a pendiente de ubicación",
          actor: actorName(),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PLACEMENT") redirect(mapUrl(warehouseId, "error", "La ubicación indicada ya no existe."));
    throw error;
  }

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", "Ubicación liberada; la cantidad vuelve a stock sin ubicar y el inventario físico no cambia."));
}
