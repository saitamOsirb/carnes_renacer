"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { SCALE_PLU_PREFIX } from "@/lib/scale-barcode";

const BARCODE_PREFIX = "barcode:";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase().slice(0, 80);
}

function normalizeScalePlu(value: string): string {
  return value.replace(/\D/g, "").slice(0, 5);
}

function statusUrl(type: "ok" | "error", message: string): string {
  return `/admin/productos?${type}=${encodeURIComponent(message)}`;
}

function refreshPriceChecker(): void {
  revalidatePath("/admin/productos");
  revalidatePath("/consulta-precio");
  revalidatePath("/admin/consulta-precio");
  revalidatePath("/admin/pos/balanza");
  revalidatePath("/admin/pos");
}

export async function updateProductBarcode(formData: FormData): Promise<void> {
  await requireAdmin();
  const productId = text(formData, "productId", 30);
  const barcode = normalizeBarcode(text(formData, "barcode", 80));
  const scalePlu = normalizeScalePlu(text(formData, "scalePlu", 20));
  const rawScalePlu = text(formData, "scalePlu", 20);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, unit: true },
  });
  if (!product) redirect(statusUrl("error", "Producto no encontrado."));

  if (barcode && !/^[A-Z0-9._-]{4,80}$/.test(barcode)) {
    redirect(statusUrl("error", "El código debe tener entre 4 y 80 caracteres alfanuméricos, punto, guion o guion bajo."));
  }
  if (rawScalePlu && !/^\d{5}$/.test(rawScalePlu)) {
    redirect(statusUrl("error", "El PLU de balanza debe tener exactamente 5 dígitos."));
  }
  if (scalePlu && product.unit !== "KG") {
    redirect(statusUrl("error", "Solo los productos vendidos por kilogramo pueden tener PLU de balanza."));
  }

  const [currentBarcodeMappings, currentPluMappings] = await Promise.all([
    prisma.storeSetting.findMany({
      where: { key: { startsWith: BARCODE_PREFIX }, value: product.id },
      select: { key: true },
    }),
    prisma.storeSetting.findMany({
      where: { key: { startsWith: SCALE_PLU_PREFIX }, value: product.id },
      select: { key: true },
    }),
  ]);

  const barcodeKey = barcode ? `${BARCODE_PREFIX}${barcode}` : null;
  const pluKey = scalePlu ? `${SCALE_PLU_PREFIX}${scalePlu}` : null;

  if (barcodeKey) {
    const conflict = await prisma.storeSetting.findUnique({ where: { key: barcodeKey } });
    if (conflict && conflict.value !== product.id) {
      redirect(statusUrl("error", `El código ${barcode} ya está asociado a otro producto.`));
    }
  }
  if (pluKey) {
    const conflict = await prisma.storeSetting.findUnique({ where: { key: pluKey } });
    if (conflict && conflict.value !== product.id) {
      redirect(statusUrl("error", `El PLU ${scalePlu} ya está asociado a otro producto.`));
    }
  }

  await prisma.$transaction(async (tx) => {
    const oldBarcodeKeys = currentBarcodeMappings.map((mapping) => mapping.key).filter((key) => key !== barcodeKey);
    const oldPluKeys = currentPluMappings.map((mapping) => mapping.key).filter((key) => key !== pluKey);

    if (oldBarcodeKeys.length > 0) await tx.storeSetting.deleteMany({ where: { key: { in: oldBarcodeKeys } } });
    if (oldPluKeys.length > 0) await tx.storeSetting.deleteMany({ where: { key: { in: oldPluKeys } } });

    if (barcodeKey) {
      await tx.storeSetting.upsert({
        where: { key: barcodeKey },
        update: { value: product.id },
        create: { key: barcodeKey, value: product.id },
      });
    }
    if (pluKey) {
      await tx.storeSetting.upsert({
        where: { key: pluKey },
        update: { value: product.id },
        create: { key: pluKey, value: product.id },
      });
    }
  });

  refreshPriceChecker();
  const details = [barcode ? `código ${barcode}` : "sin código normal", scalePlu ? `PLU ${scalePlu}` : "sin PLU de balanza"].join(" · ");
  redirect(statusUrl("ok", `${product.name}: ${details}.`));
}
