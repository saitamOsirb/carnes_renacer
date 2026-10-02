import type { Metadata } from "next";
import { PriceChecker } from "@/components/price-checker";
import { getPriceCheckerProducts } from "@/lib/price-checker-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Consulta de precio",
  description: "Consulta precios vigentes de productos Renacer Distribuidora.",
  robots: { index: false, follow: false },
};

export default async function PublicPriceCheckerPage() {
  const products = await getPriceCheckerProducts();
  return <PriceChecker products={products} mode="public" />;
}
