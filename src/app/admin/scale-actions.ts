"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  ALLOWED_SCALE_PRICE_DIVISORS,
  SCALE_PRICE_DIVISOR_KEY,
  SCALE_PRICE_PREFIXES_KEY,
  SCALE_WEIGHT_PREFIXES_KEY,
  parseScalePrefixes,
} from "@/lib/scale-barcode";

function text(formData: FormData, key: string, max = 200): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function statusUrl(type: "ok" | "error", message: string): string {
  return `/admin/pos/balanza?${type}=${encodeURIComponent(message)}`;
}

export async function saveScaleBarcodeConfig(formData: FormData): Promise<void> {
  await requireAdmin();

  const weightRaw = text(formData, "weightPrefixes");
  const priceRaw = text(formData, "pricePrefixes");
  const weightPrefixes = parseScalePrefixes(weightRaw);
  const pricePrefixes = parseScalePrefixes(priceRaw);
  const priceDivisor = Number(text(formData, "priceDivisor", 10));

  if (!weightPrefixes || !pricePrefixes) {
    redirect(statusUrl("error", "Los prefijos deben ser códigos EAN internos de dos dígitos entre 20 y 29."));
  }

  const overlap = weightPrefixes.find((prefix) => pricePrefixes.includes(prefix));
  if (overlap) {
    redirect(statusUrl("error", `El prefijo ${overlap} no puede representar peso e importe al mismo tiempo.`));
  }

  if (!ALLOWED_SCALE_PRICE_DIVISORS.includes(priceDivisor as (typeof ALLOWED_SCALE_PRICE_DIVISORS)[number])) {
    redirect(statusUrl("error", "El divisor de importe no es válido."));
  }

  const values = [
    [SCALE_WEIGHT_PREFIXES_KEY, weightPrefixes.join(",")],
    [SCALE_PRICE_PREFIXES_KEY, pricePrefixes.join(",")],
    [SCALE_PRICE_DIVISOR_KEY, String(priceDivisor)],
  ] as const;

  await prisma.$transaction(values.map(([key, value]) => prisma.storeSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })));

  revalidatePath("/admin/pos/balanza");
  revalidatePath("/admin/pos");
  redirect(statusUrl("ok", "Configuración de códigos de balanza guardada."));
}
