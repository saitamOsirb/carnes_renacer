import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isValidQuantityForUnit, roundQuantity } from "@/lib/quantity";
import {
  SCALE_PLU_PREFIX,
  SCALE_PRICE_DIVISOR_KEY,
  SCALE_PRICE_PREFIXES_KEY,
  SCALE_WEIGHT_PREFIXES_KEY,
  buildScaleBarcodeConfig,
  parseScaleEan13,
} from "@/lib/scale-barcode";

const BARCODE_PREFIX = "barcode:";

function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase().slice(0, 80);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return json({ error: "Sesión administrativa expirada." }, 401);
  }

  const barcode = normalizeBarcode(request.nextUrl.searchParams.get("code") ?? "");
  if (!/^[A-Z0-9._-]{4,80}$/.test(barcode)) {
    return json({ error: "Código inválido." }, 400);
  }

  const exactMapping = await prisma.storeSetting.findUnique({
    where: { key: `${BARCODE_PREFIX}${barcode}` },
    select: { value: true },
  });

  if (exactMapping) {
    const product = await prisma.product.findFirst({
      where: { id: exactMapping.value, active: true },
      select: { id: true },
    });
    if (!product) return json({ error: "Producto no disponible." }, 404);
    return json({ productId: product.id, barcode, source: "BARCODE" });
  }

  if (/^\d{13}$/.test(barcode)) {
    const settings = await prisma.storeSetting.findMany({
      where: { key: { in: [SCALE_WEIGHT_PREFIXES_KEY, SCALE_PRICE_PREFIXES_KEY, SCALE_PRICE_DIVISOR_KEY] } },
      select: { key: true, value: true },
    });
    const values = new Map(settings.map((setting) => [setting.key, setting.value]));
    const config = buildScaleBarcodeConfig({
      weightPrefixes: values.get(SCALE_WEIGHT_PREFIXES_KEY),
      pricePrefixes: values.get(SCALE_PRICE_PREFIXES_KEY),
      priceDivisor: values.get(SCALE_PRICE_DIVISOR_KEY),
    });
    const parsed = parseScaleEan13(barcode, config);

    if (parsed) {
      const pluMapping = await prisma.storeSetting.findUnique({
        where: { key: `${SCALE_PLU_PREFIX}${parsed.plu}` },
        select: { value: true },
      });
      if (!pluMapping) {
        return json({ error: `PLU ${parsed.plu} no configurado para la balanza.` }, 404);
      }

      const product = await prisma.product.findFirst({
        where: { id: pluMapping.value, active: true },
        select: { id: true, unit: true, price: true },
      });
      if (!product) return json({ error: "Producto de balanza no disponible." }, 404);
      if (product.unit !== "KG") return json({ error: "El PLU de balanza debe pertenecer a un producto por kilogramo." }, 422);

      const quantity = parsed.mode === "WEIGHT"
        ? parsed.quantityKg ?? 0
        : product.price > 0 && parsed.amountClp !== null
          ? roundQuantity(parsed.amountClp / product.price)
          : 0;

      if (!isValidQuantityForUnit(quantity, "KG")) {
        return json({ error: parsed.mode === "PRICE" ? "No fue posible derivar un peso válido desde el importe de la etiqueta." : "La etiqueta contiene un peso inválido." }, 422);
      }

      return json({
        productId: product.id,
        barcode,
        source: "SCALE",
        scaleMode: parsed.mode,
        plu: parsed.plu,
        quantity,
        encodedAmount: parsed.amountClp,
      });
    }
  }

  return json({ error: "Código no registrado." }, 404);
}
