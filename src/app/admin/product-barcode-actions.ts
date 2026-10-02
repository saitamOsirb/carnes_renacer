"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const BARCODE_PREFIX = "barcode:";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase().slice(0, 80);
}

function statusUrl(type: "ok" | "error", message: string): string {
  return `/admin/productos?${type}=${encodeURIComponent(message)}`;
}

function refreshPriceChecker(): void {
  revalidatePath("/admin/productos");
  revalidatePath("/consulta-precio");
  revalidatePath("/admin/consulta-precio");
}

export async function updateProductBarcode(formData: FormData): Promise<void> {
  await requireAdmin();
  const productId = text(formData, "productId", 30);
  const barcode = normalizeBarcode(text(formData, "barcode", 80));
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });
  if (!product) redirect(statusUrl("error", "Producto no encontrado."));

  if (barcode && !/^[A-Z0-9._-]{4,80}$/.test(barcode)) {
    redirect(statusUrl("error", "El código debe tener entre 4 y 80 caracteres alfanuméricos, punto, guion o guion bajo."));
  }

  const currentMappings = await prisma.storeSetting.findMany({
    where: { key: { startsWith: BARCODE_PREFIX }, value: product.id },
    select: { key: true },
  });

  if (barcode) {
    const key = `${BARCODE_PREFIX}${barcode}`;
    const conflict = await prisma.storeSetting.findUnique({ where: { key } });
    if (conflict && conflict.value !== product.id) {
      redirect(statusUrl("error", `El código ${barcode} ya está asociado a otro producto.`));
    }

    await prisma.$transaction(async (tx) => {
      const oldKeys = currentMappings.map((mapping) => mapping.key).filter((oldKey) => oldKey !== key);
      if (oldKeys.length > 0) await tx.storeSetting.deleteMany({ where: { key: { in: oldKeys } } });
      await tx.storeSetting.upsert({
        where: { key },
        update: { value: product.id },
        create: { key, value: product.id },
      });
    });

    refreshPriceChecker();
    redirect(statusUrl("ok", `Código ${barcode} asociado a ${product.name}.`));
  }

  if (currentMappings.length > 0) {
    await prisma.storeSetting.deleteMany({ where: { key: { in: currentMappings.map((mapping) => mapping.key) } } });
  }
  refreshPriceChecker();
  redirect(statusUrl("ok", `Código de barras retirado de ${product.name}.`));
}
