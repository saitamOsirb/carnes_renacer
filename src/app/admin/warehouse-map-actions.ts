"use server";

import { WarehouseVisualObjectType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const MAX_OBJECTS = 180;
const VALID_TYPES = new Set(Object.values(WarehouseVisualObjectType));

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function metersToCm(formData: FormData, key: string, minCm: number, maxCm: number): number | null {
  const raw = text(formData, key, 30).replace(",", ".");
  if (!raw) return null;
  const meters = Number(raw);
  if (!Number.isFinite(meters)) return null;
  const cm = Math.round(meters * 100);
  return cm >= minCm && cm <= maxCm ? cm : null;
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

  return {
    id,
    type: typeRaw as WarehouseVisualObjectType,
    label,
    xCm,
    zCm,
    widthCm,
    depthCm,
    heightCm,
    rotation,
  };
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

  const existing = await prisma.warehouseLayout.findUnique({
    where: { warehouseId },
    include: { objects: true },
  });
  if (existing) {
    const outside = existing.objects.find((object) => object.xCm + object.widthCm > widthCm || object.zCm + object.depthCm > depthCm || object.heightCm > heightCm);
    if (outside) {
      redirect(mapUrl(warehouseId, "error", `El objeto ${outside.label} quedaría fuera de las nuevas dimensiones.`));
    }
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
  if (normalized.some((item) => item === null)) {
    redirect(mapUrl(warehouseId, "error", "Uno o más objetos tienen medidas o datos inválidos."));
  }
  const objects = normalized as NormalizedSceneObject[];

  const layout = await prisma.warehouseLayout.findUnique({
    where: { warehouseId },
    include: { objects: { select: { id: true } } },
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

  await prisma.$transaction(async (tx) => {
    await tx.warehouseVisualObject.deleteMany({
      where: {
        layoutId: layout.id,
        ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
      },
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
  });

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", "Plano virtual guardado correctamente."));
}

export async function assignWarehouseProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const productId = text(formData, "productId", 30);
  const objectId = text(formData, "objectId", 30);
  const locationCode = text(formData, "locationCode", 80);

  if (!warehouseId || !productId || !objectId) {
    redirect(mapUrl(warehouseId, "error", "Selecciona producto y ubicación física."));
  }

  const [object, stock] = await Promise.all([
    prisma.warehouseVisualObject.findFirst({
      where: { id: objectId, layout: { warehouseId } },
      select: { id: true, label: true },
    }),
    prisma.inventoryStock.findUnique({
      where: { warehouseId_productId: { warehouseId, productId } },
      include: { product: { select: { name: true } } },
    }),
  ]);

  if (!object) redirect(mapUrl(warehouseId, "error", "La ubicación seleccionada no pertenece a esta bodega."));
  if (!stock) redirect(mapUrl(warehouseId, "error", "Ese producto todavía no tiene una posición de inventario en esta bodega."));

  await prisma.warehouseProductPlacement.upsert({
    where: { warehouseId_productId: { warehouseId, productId } },
    update: { objectId, locationCode: locationCode || null },
    create: { warehouseId, productId, objectId, locationCode: locationCode || null },
  });

  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", `${stock.product.name} ubicado en ${object.label}.`));
}

export async function removeWarehouseProductPlacement(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const productId = text(formData, "productId", 30);
  if (!warehouseId || !productId) redirect(mapUrl(warehouseId, "error", "Ubicación de producto inválida."));

  await prisma.warehouseProductPlacement.deleteMany({ where: { warehouseId, productId } });
  refreshWarehouseMap();
  redirect(mapUrl(warehouseId, "ok", "Producto retirado del mapa virtual; el stock real no fue modificado."));
}
