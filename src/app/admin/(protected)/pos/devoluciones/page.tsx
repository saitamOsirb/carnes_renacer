import Link from "next/link";
import { DteDocumentType, PosPaymentMethod } from "@prisma/client";
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

export default async function PosReturnsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 80) ?? "";
  const returns = await prisma.posReturn.findMany({
    where: q ? {
      OR: [
        { returnNumber: { contains: q } },
        { reason: { contains: q } },
        { sale: { saleNumber: { contains: q } } },
      ],
    } : undefined,
    include: {
      sale: { select: { id: true, saleNumber: true, customerName: true, paymentMethod: true } },
      warehouse: { select: { code: true, name: true } },
      shift: { include: { register: true, user: true } },
      dteDocuments: { orderBy: { createdAt: "desc" } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const totalAmount = returns.reduce((sum, item) => sum + item.totalAmount, 0);
  const cashAmount = returns.filter((item) => item.refundMethod === PosPaymentMethod.CASH).reduce((sum, item) => sum + item.totalAmount, 0);
  const withCreditNote = returns.filter((item) => item.dteDocuments.some((document) => document.type === DteDocumentType.NOTA_CREDITO)).length;

  return (
    <div className="admin-content pos-admin-page">
      <div className="admin-title-row">
        <div><span className="admin-kicker">POS · Postventa</span><h1>Devoluciones</h1><p>Auditoría de devoluciones parciales y totales, reembolsos y notas de crédito asociadas.</p></div>
        <div className="pos-page-actions"><Link className="admin-button admin-button-secondary" href="/admin/pos">POS</Link><Link className="admin-button admin-button-secondary" href="/admin/pos/reportes">Reportes</Link></div>
      </div>

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{returns.length}</strong><span>devoluciones mostradas</span></div>
        <div className="admin-stat"><strong>{formatClp(totalAmount)}</strong><span>reembolsado</span></div>
        <div className="admin-stat"><strong>{formatClp(cashAmount)}</strong><span>reembolso efectivo</span></div>
        <div className="admin-stat"><strong>{withCreditNote}</strong><span>con NC 61</span></div>
      </section>

      <form method="get" className="admin-card admin-form" style={{ marginBottom: 20 }}>
        <label>Buscar devolución, venta o motivo<input name="q" defaultValue={q} placeholder="DEV-..., POS-..., motivo..." /></label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="admin-button admin-button-primary" type="submit">Buscar</button>
          {q && <Link className="admin-button admin-button-secondary" href="/admin/pos/devoluciones">Limpiar</Link>}
        </div>
      </form>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Historial</h2><p>Últimas 200 devoluciones que coinciden con el filtro.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Fecha</th><th>Devolución</th><th>Venta origen</th><th>Caja</th><th>Pago</th><th>Líneas</th><th>Reembolso</th><th>NC 61</th></tr></thead>
            <tbody>
              {returns.length === 0 && <tr><td colSpan={8}>No hay devoluciones para mostrar.</td></tr>}
              {returns.map((posReturn) => {
                const creditNote = posReturn.dteDocuments.find((document) => document.type === DteDocumentType.NOTA_CREDITO) ?? null;
                return <tr key={posReturn.id}>
                  <td>{posReturn.createdAt.toLocaleString("es-CL")}</td>
                  <td><strong>{posReturn.returnNumber}</strong><small>{posReturn.reason}</small></td>
                  <td><Link href={`/admin/pos/ventas/${posReturn.sale.id}`}>{posReturn.sale.saleNumber}</Link>{posReturn.sale.customerName && <small>{posReturn.sale.customerName}</small>}</td>
                  <td>{posReturn.shift?.register.name ?? "—"}<small>{posReturn.shift?.user.name ?? posReturn.warehouse.name}</small></td>
                  <td>{paymentLabels[posReturn.refundMethod]}</td>
                  <td>{posReturn._count.items}</td>
                  <td><strong>{formatClp(posReturn.totalAmount)}</strong><small>bruto {formatClp(posReturn.grossAmount)} · dto. {formatClp(posReturn.discountAmount)}</small></td>
                  <td>{creditNote ? <Link href={`/admin/facturacion/${creditNote.id}`}>Folio {creditNote.folio} · {creditNote.status}</Link> : <span>Pendiente / sin DTE origen</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
