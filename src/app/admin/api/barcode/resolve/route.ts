import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

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

  const mapping = await prisma.storeSetting.findUnique({
    where: { key: `${BARCODE_PREFIX}${barcode}` },
    select: { value: true },
  });
  if (!mapping) return json({ error: "Código no registrado." }, 404);

  const product = await prisma.product.findFirst({
    where: { id: mapping.value, active: true },
    select: { id: true },
  });
  if (!product) return json({ error: "Producto no disponible." }, 404);

  return json({ productId: product.id, barcode });
}
