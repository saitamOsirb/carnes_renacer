"use server";

import { PosPaymentMethod } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createPosSale, PosSaleError, type PosSaleLineInput } from "@/lib/pos-service";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(formData: FormData, key: string, min = 0, max = 999_999_999): number | null {
  const raw = text(formData, key, 30);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function statusUrl(type: "ok" | "error", message: string, saleId?: string, shiftId?: string): string {
  const params = new URLSearchParams({ [type]: message });
  if (saleId) params.set("sale", saleId);
  if (shiftId) params.set("shift", shiftId);
  return `/admin/pos?${params.toString()}`;
}

function parseItems(raw: string): PosSaleLineInput[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const candidate = item as { productId?: unknown; quantity?: unknown };
      return {
        productId: typeof candidate.productId === "string" ? candidate.productId : "",
        quantity: Number(candidate.quantity),
      };
    });
  } catch {
    return [];
  }
}

export async function createPosSaleAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const shiftId = text(formData, "shiftId", 30);
  const items = parseItems(text(formData, "items", 20_000));
  const discount = integer(formData, "discount", 0) ?? 0;
  const paymentRaw = text(formData, "paymentMethod", 30);
  const paymentMethod = Object.values(PosPaymentMethod).includes(paymentRaw as PosPaymentMethod)
    ? (paymentRaw as PosPaymentMethod)
    : null;

  if (!shiftId) redirect(statusUrl("error", "Selecciona o abre un turno de caja antes de vender."));
  if (!paymentMethod) redirect(statusUrl("error", "Selecciona un medio de pago válido.", undefined, shiftId));

  const amountReceived = paymentMethod === PosPaymentMethod.CASH
    ? integer(formData, "amountReceived", 0)
    : null;

  let sale;
  try {
    sale = await createPosSale({
      shiftId,
      items,
      discount,
      paymentMethod,
      amountReceived,
      customerName: text(formData, "customerName", 191),
      customerRut: text(formData, "customerRut", 20),
      notes: text(formData, "notes", 500),
    });
  } catch (error) {
    if (error instanceof PosSaleError) redirect(statusUrl("error", error.message, undefined, shiftId));
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/carrito");
  revalidatePath("/checkout");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/pos");
  revalidatePath("/admin/pos/reportes");
  redirect(statusUrl("ok", `Venta ${sale.saleNumber} registrada correctamente.`, sale.id, shiftId));
}
