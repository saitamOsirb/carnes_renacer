import { getActiveProducts } from "@/lib/catalog-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const products = await getActiveProducts();
  return Response.json(
    { products },
    { headers: { "Cache-Control": "no-store" } },
  );
}
