import "server-only";

import { prisma } from "@/lib/prisma";

export const LABEL_TEMPLATE_KEY = "label:template:default";
const BARCODE_PREFIX = "barcode:";

export type LabelTemplate = {
  name: string;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  paddingMm: number;
  printMode: "ROLL" | "SHEET";
  showCompany: boolean;
  showCategory: boolean;
  showPrice: boolean;
  showUnit: boolean;
  showBarcode: boolean;
  showImage: boolean;
  showDate: boolean;
  border: boolean;
};

export type LabelProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  price: number;
  unit: "KG" | "UNIT";
  barcode: string | null;
};

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  name: "Etiqueta estándar",
  widthMm: 58,
  heightMm: 40,
  gapMm: 2,
  paddingMm: 2,
  printMode: "ROLL",
  showCompany: true,
  showCategory: true,
  showPrice: true,
  showUnit: true,
  showBarcode: true,
  showImage: false,
  showDate: false,
  border: false,
};

function inRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeLabelTemplate(value: unknown): LabelTemplate {
  if (!value || typeof value !== "object") return DEFAULT_LABEL_TEMPLATE;
  const raw = value as Partial<LabelTemplate>;
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : DEFAULT_LABEL_TEMPLATE.name,
    widthMm: inRange(raw.widthMm, 25, 120, DEFAULT_LABEL_TEMPLATE.widthMm),
    heightMm: inRange(raw.heightMm, 20, 100, DEFAULT_LABEL_TEMPLATE.heightMm),
    gapMm: inRange(raw.gapMm, 0, 12, DEFAULT_LABEL_TEMPLATE.gapMm),
    paddingMm: inRange(raw.paddingMm, 0, 8, DEFAULT_LABEL_TEMPLATE.paddingMm),
    printMode: raw.printMode === "SHEET" ? "SHEET" : "ROLL",
    showCompany: booleanValue(raw.showCompany, DEFAULT_LABEL_TEMPLATE.showCompany),
    showCategory: booleanValue(raw.showCategory, DEFAULT_LABEL_TEMPLATE.showCategory),
    showPrice: booleanValue(raw.showPrice, DEFAULT_LABEL_TEMPLATE.showPrice),
    showUnit: booleanValue(raw.showUnit, DEFAULT_LABEL_TEMPLATE.showUnit),
    showBarcode: booleanValue(raw.showBarcode, DEFAULT_LABEL_TEMPLATE.showBarcode),
    showImage: booleanValue(raw.showImage, DEFAULT_LABEL_TEMPLATE.showImage),
    showDate: booleanValue(raw.showDate, DEFAULT_LABEL_TEMPLATE.showDate),
    border: booleanValue(raw.border, DEFAULT_LABEL_TEMPLATE.border),
  };
}

export async function getLabelManagerData(): Promise<{ template: LabelTemplate; products: LabelProduct[] }> {
  const [products, barcodeSettings, storedTemplate] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      select: { id: true, name: true, category: true, imageUrl: true, price: true, unit: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.storeSetting.findMany({
      where: { key: { startsWith: BARCODE_PREFIX } },
      select: { key: true, value: true },
    }),
    prisma.storeSetting.findUnique({ where: { key: LABEL_TEMPLATE_KEY }, select: { value: true } }),
  ]);

  const barcodeByProduct = new Map(
    barcodeSettings.map((setting) => [setting.value, setting.key.slice(BARCODE_PREFIX.length)]),
  );

  let template = DEFAULT_LABEL_TEMPLATE;
  if (storedTemplate?.value) {
    try {
      template = sanitizeLabelTemplate(JSON.parse(storedTemplate.value));
    } catch {
      template = DEFAULT_LABEL_TEMPLATE;
    }
  }

  return {
    template,
    products: products.map((product) => ({ ...product, barcode: barcodeByProduct.get(product.id) ?? null })),
  };
}
