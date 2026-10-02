"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  parsePurchaseReceiptDocumentType,
  PurchaseError,
  receivePurchaseOrder,
  type PurchaseOrderLineInput,
} from "@/lib/purchase-service";
import { roundQuantity } from "@/lib/quantity";

function text(formData: FormData, key: string, max = 1000): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberValue(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return Number.NaN;
  return Number(value.trim().replace(",", "."));
}

function statusUrl(path: string, type: "ok" | "error", message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${type}=${encodeURIComponent(message)}`;
}

function message(error: unknown): string {
  if (error instanceof PurchaseError) return error.message;
  return "No fue posible completar la operación de compras.";
}

function refreshPurchases(orderId?: string): void {
  revalidatePath("/admin/compras");
  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
  revalidatePath("/admin/productos");
  revalidatePath("/");
  if (orderId) revalidatePath(`/admin/compras/${orderId}`);
}

function parseOrderLines(raw: string): PurchaseOrderLineInput[] {
  if (!raw || raw.length > 100_000) throw new PurchaseError("El detalle de la orden es inválido.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PurchaseError("No fue posible interpretar las líneas de la orden.");
  }
  if (!Array.isArray(parsed)) throw new PurchaseError("El detalle de la orden debe ser una lista de productos.");
  return parsed.map((entry) => {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    return {
      productId: typeof item.productId === "string" ? item.productId : "",
      quantity: Number(item.quantity),
      unitCostNet: Number(item.unitCostNet),
    };
  });
}

export async function createPurchaseOrderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const expectedDateRaw = text(formData, "expectedDate", 10);
  const vatRate = Number(text(formData, "vatRate", 3) || "19");
  let expectedDate: Date | null = null;
  if (expectedDateRaw) {
    const candidate = new Date(`${expectedDateRaw}T12:00:00`);
    if (Number.isNaN(candidate.getTime())) redirect(statusUrl("/admin/compras", "error", "La fecha esperada no es válida."));
    expectedDate = candidate;
  }

  let orderId = "";
  let orderNumber = "";
  try {
    const order = await createPurchaseOrder({
      requestKey: text(formData, "requestKey", 64),
      supplierId: text(formData, "supplierId", 30),
      warehouseId: text(formData, "warehouseId", 30),
      expectedDate,
      supplierReference: text(formData, "supplierReference", 100),
      vatRate,
      notes: text(formData, "notes", 1000),
      items: parseOrderLines(text(formData, "itemsJson", 100_000)),
    });
    orderId = order.id;
    orderNumber = order.orderNumber;
  } catch (error) {
    redirect(statusUrl("/admin/compras", "error", message(error)));
  }

  refreshPurchases(orderId);
  redirect(statusUrl(`/admin/compras/${orderId}`, "ok", `Orden ${orderNumber} creada correctamente.`));
}

export async function receivePurchaseOrderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const purchaseOrderId = text(formData, "purchaseOrderId", 30);
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, items: { select: { id: true, unitCostNet: true } } },
  });
  if (!order) redirect(statusUrl("/admin/compras", "error", "Orden de compra no encontrada."));

  const items = order.items.map((item) => ({
    purchaseOrderItemId: item.id,
    quantity: roundQuantity(numberValue(formData.get(`quantity_${item.id}`)) || 0),
    unitCostNet: Number.isFinite(numberValue(formData.get(`cost_${item.id}`)))
      ? Math.trunc(numberValue(formData.get(`cost_${item.id}`)))
      : item.unitCostNet,
  })).filter((item) => item.quantity > 0);

  let receiptNumber = "";
  try {
    const receipt = await receivePurchaseOrder({
      requestKey: text(formData, "requestKey", 64),
      purchaseOrderId,
      documentType: parsePurchaseReceiptDocumentType(text(formData, "documentType", 30)),
      supplierDocumentNumber: text(formData, "supplierDocumentNumber", 100),
      receivedBy: text(formData, "receivedBy", 80) || process.env.ADMIN_USERNAME?.trim() || "admin",
      notes: text(formData, "notes", 1000),
      items,
    });
    receiptNumber = receipt.receiptNumber;
  } catch (error) {
    redirect(statusUrl(`/admin/compras/${purchaseOrderId}`, "error", message(error)));
  }

  refreshPurchases(purchaseOrderId);
  redirect(statusUrl(`/admin/compras/${purchaseOrderId}`, "ok", `Recepción ${receiptNumber} registrada. El stock quedó disponible y pendiente de ubicación WMS.`));
}

export async function cancelPurchaseOrderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const purchaseOrderId = text(formData, "purchaseOrderId", 30);
  try {
    await cancelPurchaseOrder(purchaseOrderId);
  } catch (error) {
    redirect(statusUrl(`/admin/compras/${purchaseOrderId}`, "error", message(error)));
  }
  refreshPurchases(purchaseOrderId);
  redirect(statusUrl(`/admin/compras/${purchaseOrderId}`, "ok", "Orden de compra cancelada."));
}
