"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { LABEL_TEMPLATE_KEY, sanitizeLabelTemplate } from "@/lib/label-service";
import { prisma } from "@/lib/prisma";

function text(formData: FormData, key: string, max = 100): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberValue(formData: FormData, key: string, fallback: number): number {
  const value = Number(text(formData, key, 30));
  return Number.isFinite(value) ? value : fallback;
}

function checked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

function statusUrl(type: "ok" | "error", message: string): string {
  return `/admin/etiquetas?${type}=${encodeURIComponent(message)}`;
}

export async function saveLabelTemplate(formData: FormData): Promise<void> {
  await requireAdmin();

  const raw = {
    name: text(formData, "name", 60) || "Etiqueta estándar",
    widthMm: numberValue(formData, "widthMm", 58),
    heightMm: numberValue(formData, "heightMm", 40),
    gapMm: numberValue(formData, "gapMm", 2),
    paddingMm: numberValue(formData, "paddingMm", 2),
    printMode: text(formData, "printMode", 10) === "SHEET" ? "SHEET" : "ROLL",
    showCompany: checked(formData, "showCompany"),
    showCategory: checked(formData, "showCategory"),
    showPrice: checked(formData, "showPrice"),
    showUnit: checked(formData, "showUnit"),
    showBarcode: checked(formData, "showBarcode"),
    showImage: checked(formData, "showImage"),
    showDate: checked(formData, "showDate"),
    border: checked(formData, "border"),
  };

  if (raw.widthMm < 25 || raw.widthMm > 120 || raw.heightMm < 20 || raw.heightMm > 100) {
    redirect(statusUrl("error", "El tamaño de etiqueta debe estar entre 25–120 mm de ancho y 20–100 mm de alto."));
  }

  const template = sanitizeLabelTemplate(raw);
  const serialized = JSON.stringify(template);
  if (serialized.length > 500) {
    redirect(statusUrl("error", "La configuración de etiqueta supera el tamaño permitido."));
  }

  await prisma.storeSetting.upsert({
    where: { key: LABEL_TEMPLATE_KEY },
    update: { value: serialized },
    create: { key: LABEL_TEMPLATE_KEY, value: serialized },
  });

  revalidatePath("/admin/etiquetas");
  redirect(statusUrl("ok", `Plantilla ${template.name} guardada.`));
}
