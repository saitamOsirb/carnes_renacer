import Link from "next/link";
import { PriceChecker } from "@/components/price-checker";
import { getPriceCheckerProducts } from "@/lib/price-checker-service";

export const dynamic = "force-dynamic";

export default async function AdminPriceCheckerPage() {
  const products = await getPriceCheckerProducts();

  return (
    <div className="price-checker-admin-shell">
      <div className="price-checker-admin-heading">
        <div>
          <span className="admin-kicker">Herramientas de tienda</span>
          <h1>Consulta de precio</h1>
          <p>Usa la misma fuente de precios y disponibilidad del catálogo activo.</p>
        </div>
        <Link className="admin-button admin-button-secondary" href="/consulta-precio" target="_blank" rel="noreferrer">
          Abrir modo kiosco
        </Link>
      </div>

      <PriceChecker products={products} mode="admin" />
    </div>
  );
}
