import Link from "next/link";
import { PosPaymentMethod } from "@prisma/client";
import { PosTerminal } from "@/components/admin/pos-terminal";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const paymentLabels: Record<PosPaymentMethod, string> = {
  CASH: "Efectivo",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

export default async function AdminPosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; sale?: string }> }) {
  const [warehouseRows, recentSales, query] = await Promise.all([
    prisma.warehouse.findMany({
      where: { active: true },
      include: {
        stocks: {
          where: { product: { active: true } },
          include: { product: true },
        },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.posSale.findMany({
      include: { warehouse: true, _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    searchParams,
  ]);

  const warehouses = warehouseRows.map((warehouse) => ({
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    isDefault: warehouse.isDefault,
    products: warehouse.stocks
      .map((stock) => ({
        id: stock.product.id,
        name: stock.product.name,
        category: stock.product.category,
        imageUrl: stock.product.imageUrl,
        price: stock.product.price,
        unit: stock.product.unit,
        available: Math.max(0, stock.onHand - stock.reserved),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "es")),
  }));

  return (
    <div className="admin-content pos-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Venta presencial</span>
          <h1>Punto de venta</h1>
          <p>Registra ventas de mostrador y descuenta el stock de la bodega seleccionada en tiempo real.</p>
        </div>
        <div className="admin-stat"><strong>{recentSales.length}</strong><span>ventas recientes</span></div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}{query.sale && <> · <Link href={`/admin/pos/ventas/${query.sale}`}>Ver comprobante</Link></>}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <PosTerminal warehouses={warehouses} />

      <section className="admin-card pos-history">
        <div className="admin-card-heading">
          <div><h2>Ventas recientes</h2><p>Últimas 20 operaciones registradas en caja.</p></div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Fecha</th><th>N° venta</th><th>Bodega</th><th>Pago</th><th>Productos</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {recentSales.length === 0 && <tr><td colSpan={7}>Aún no hay ventas POS.</td></tr>}
              {recentSales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.createdAt.toLocaleString("es-CL")}</td>
                  <td><strong>{sale.saleNumber}</strong>{sale.customerName && <small>{sale.customerName}</small>}</td>
                  <td>{sale.warehouse.name}</td>
                  <td>{paymentLabels[sale.paymentMethod]}</td>
                  <td>{sale._count.items}</td>
                  <td><strong>{formatClp(sale.total)}</strong></td>
                  <td><Link className="pos-receipt-link" href={`/admin/pos/ventas/${sale.id}`}>Comprobante</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
