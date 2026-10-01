"use server";

import { randomUUID } from "node:crypto";
import { InventoryMovementType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { syncProductInventory } from "@/lib/inventory-service";
import { prisma } from "@/lib/prisma";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(formData: FormData, key: string, min = 0, max = 100_000_000): number | null {
  const raw = text(formData, key, 30);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function normalizeCode(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function statusUrl(type: "ok" | "error", message: string): string {
  return `/admin/inventario?${type}=${encodeURIComponent(message)}`;
}

function refreshInventory(): void {
  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/carrito");
  revalidatePath("/checkout");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/inventario");
}

export async function createWarehouse(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = text(formData, "name", 191);
  const code = normalizeCode(text(formData, "code", 40));
  const address = text(formData, "address", 255);

  if (name.length < 2 || code.length < 2) {
    redirect(statusUrl("error", "Ingresa un nombre y código válidos para la bodega."));
  }
  if (await prisma.warehouse.findUnique({ where: { code }, select: { id: true } })) {
    redirect(statusUrl("error", `Ya existe una bodega con el código ${code}.`));
  }

  await prisma.warehouse.create({ data: { name, code, address: address || null, active: true } });
  refreshInventory();
  redirect(statusUrl("ok", `Bodega ${name} creada correctamente.`));
}

export async function updateWarehouse(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const current = await prisma.warehouse.findUnique({ where: { id } });
  if (!current) redirect(statusUrl("error", "Bodega no encontrada."));

  const name = text(formData, "name", 191);
  const code = normalizeCode(text(formData, "code", 40));
  const address = text(formData, "address", 255);
  const active = formData.get("active") === "on";
  const makeDefault = formData.get("isDefault") === "on";

  if (name.length < 2 || code.length < 2) redirect(statusUrl("error", "Nombre o código de bodega inválido."));
  const duplicate = await prisma.warehouse.findUnique({ where: { code }, select: { id: true } });
  if (duplicate && duplicate.id !== id) redirect(statusUrl("error", `El código ${code} ya está en uso.`));
  if (current.isDefault && !active) redirect(statusUrl("error", "La bodega principal no se puede desactivar."));

  if (!active) {
    const occupied = await prisma.inventoryStock.findFirst({
      where: { warehouseId: id, OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }] },
      select: { id: true },
    });
    if (occupied) redirect(statusUrl("error", "Transfiere o ajusta a cero el stock antes de desactivar la bodega."));
  }

  await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.warehouse.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    }
    await tx.warehouse.update({
      where: { id },
      data: {
        name,
        code,
        address: address || null,
        active: makeDefault ? true : active,
        isDefault: makeDefault || current.isDefault,
      },
    });
  });

  refreshInventory();
  redirect(statusUrl("ok", `Bodega ${name} actualizada.`));
}

export async function applyStockMovement(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const productId = text(formData, "productId", 30);
  const mode = text(formData, "mode", 20);
  const quantity = integer(formData, "quantity", 0, 10_000_000);
  const note = text(formData, "note", 500);

  if (!warehouseId || !productId || quantity === null || !["RECEIVE", "ISSUE", "SET"].includes(mode)) {
    redirect(statusUrl("error", "Movimiento de stock inválido."));
  }
  if (mode !== "SET" && quantity === 0) redirect(statusUrl("error", "La cantidad debe ser mayor que cero."));

  const [warehouse, product] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: warehouseId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);
  if (!warehouse?.active) redirect(statusUrl("error", "La bodega seleccionada no está activa."));
  if (!product) redirect(statusUrl("error", "Producto no encontrado."));

  try {
    await prisma.$transaction(async (tx) => {
      const stock = await tx.inventoryStock.upsert({
        where: { warehouseId_productId: { warehouseId, productId } },
        update: {},
        create: { warehouseId, productId, onHand: 0, reserved: 0, minStock: 0 },
      });

      let newOnHand = stock.onHand;
      let delta = 0;
      let type: InventoryMovementType;

      if (mode === "RECEIVE") {
        newOnHand = stock.onHand + quantity;
        delta = quantity;
        type = InventoryMovementType.RECEIVE;
      } else if (mode === "ISSUE") {
        if (stock.onHand - stock.reserved < quantity) throw new Error("STOCK_NOT_AVAILABLE");
        newOnHand = stock.onHand - quantity;
        delta = -quantity;
        type = InventoryMovementType.ISSUE;
      } else {
        if (quantity < stock.reserved) throw new Error("BELOW_RESERVED");
        newOnHand = quantity;
        delta = quantity - stock.onHand;
        type = InventoryMovementType.ADJUSTMENT;
      }

      await tx.inventoryStock.update({ where: { id: stock.id }, data: { onHand: newOnHand } });
      if (delta !== 0 || mode === "SET") {
        await tx.inventoryMovement.create({
          data: {
            warehouseId,
            productId,
            type,
            quantity: delta,
            onHandAfter: newOnHand,
            reservedAfter: stock.reserved,
            note: note || null,
            reference: `ADM-${randomUUID().slice(0, 12)}`,
          },
        });
      }
      await syncProductInventory(tx, productId);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STOCK_NOT_AVAILABLE") redirect(statusUrl("error", "No hay stock disponible suficiente para registrar la salida."));
    if (error instanceof Error && error.message === "BELOW_RESERVED") redirect(statusUrl("error", "El stock físico no puede quedar por debajo de lo reservado."));
    throw error;
  }

  refreshInventory();
  redirect(statusUrl("ok", `Stock de ${product.name} actualizado en ${warehouse.name}.`));
}

export async function transferStock(formData: FormData): Promise<void> {
  await requireAdmin();
  const sourceWarehouseId = text(formData, "sourceWarehouseId", 30);
  const targetWarehouseId = text(formData, "targetWarehouseId", 30);
  const productId = text(formData, "productId", 30);
  const quantity = integer(formData, "quantity", 1, 10_000_000);
  const note = text(formData, "note", 500);

  if (!sourceWarehouseId || !targetWarehouseId || sourceWarehouseId === targetWarehouseId || !productId || quantity === null) {
    redirect(statusUrl("error", "Transferencia inválida."));
  }

  const reference = `TR-${randomUUID().slice(0, 12)}`;
  try {
    await prisma.$transaction(async (tx) => {
      const [sourceWarehouse, targetWarehouse, product] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: sourceWarehouseId } }),
        tx.warehouse.findUnique({ where: { id: targetWarehouseId } }),
        tx.product.findUnique({ where: { id: productId } }),
      ]);
      if (!sourceWarehouse?.active || !targetWarehouse?.active || !product) throw new Error("INVALID_TRANSFER_TARGET");

      const source = await tx.inventoryStock.findUnique({
        where: { warehouseId_productId: { warehouseId: sourceWarehouseId, productId } },
      });
      if (!source || source.onHand - source.reserved < quantity) throw new Error("STOCK_NOT_AVAILABLE");

      const target = await tx.inventoryStock.upsert({
        where: { warehouseId_productId: { warehouseId: targetWarehouseId, productId } },
        update: {},
        create: { warehouseId: targetWarehouseId, productId, onHand: 0, reserved: 0, minStock: 0 },
      });

      await tx.inventoryStock.update({ where: { id: source.id }, data: { onHand: { decrement: quantity } } });
      await tx.inventoryStock.update({ where: { id: target.id }, data: { onHand: { increment: quantity } } });
      await tx.inventoryMovement.createMany({
        data: [
          {
            warehouseId: sourceWarehouseId,
            productId,
            type: InventoryMovementType.TRANSFER_OUT,
            quantity: -quantity,
            onHandAfter: source.onHand - quantity,
            reservedAfter: source.reserved,
            note: note || `Transferencia hacia ${targetWarehouse.name}`,
            reference,
          },
          {
            warehouseId: targetWarehouseId,
            productId,
            type: InventoryMovementType.TRANSFER_IN,
            quantity,
            onHandAfter: target.onHand + quantity,
            reservedAfter: target.reserved,
            note: note || `Transferencia desde ${sourceWarehouse.name}`,
            reference,
          },
        ],
      });
      await syncProductInventory(tx, productId);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STOCK_NOT_AVAILABLE") redirect(statusUrl("error", "La bodega origen no tiene stock disponible suficiente."));
    if (error instanceof Error && error.message === "INVALID_TRANSFER_TARGET") redirect(statusUrl("error", "Producto o bodega inválidos para la transferencia."));
    throw error;
  }

  refreshInventory();
  redirect(statusUrl("ok", "Transferencia registrada correctamente."));
}

export async function updateMinimumStock(formData: FormData): Promise<void> {
  await requireAdmin();
  const warehouseId = text(formData, "warehouseId", 30);
  const productId = text(formData, "productId", 30);
  const minStock = integer(formData, "minStock", 0, 10_000_000);
  if (!warehouseId || !productId || minStock === null) redirect(statusUrl("error", "Stock mínimo inválido."));

  await prisma.inventoryStock.upsert({
    where: { warehouseId_productId: { warehouseId, productId } },
    update: { minStock },
    create: { warehouseId, productId, onHand: 0, reserved: 0, minStock },
  });
  refreshInventory();
  redirect(statusUrl("ok", "Stock mínimo actualizado."));
}
