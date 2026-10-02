import Link from "next/link";
import { DteDocumentType, DteStatus } from "@prisma/client";
import { issuePosDteAction, retryDteAction, syncDteStatusAction } from "@/app/admin/billing-actions";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSiiConfig, getSiiReadiness } from "@/lib/sii/config";

export const dynamic = "force-dynamic";

const statusLabel: Record<DteStatus, string> = {
  DRAFT: "Borrador",
  GENERATED: "Generado",
  QUEUED: "En cola",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  OBSERVED: "Observado",
  REJECTED: "Rechazado",
  ERROR: "Error",
  CANCELLED: "Anulado",
};

function typeShort(type: DteDocumentType): string {
  if (type === DteDocumentType.BOLETA_ELECTRONICA) return "Boleta 39";
  if (type === DteDocumentType.FACTURA_ELECTRONICA) return "Factura 33";
  if (type === DteDocumentType.NOTA_CREDITO) return "NC 61";
  return "ND 56";
}

function isPendingStatus(status: DteStatus): boolean {
  return status === DteStatus.GENERATED || status === DteStatus.QUEUED || status === DteStatus.SENT;
}

function isProblemStatus(status: DteStatus): boolean {
  return status === DteStatus.ERROR || status === DteStatus.REJECTED || status === DteStatus.OBSERVED;
}

function isRetryableStatus(status: DteStatus): boolean {
  return status === DteStatus.ERROR || status === DteStatus.GENERATED || status === DteStatus.QUEUED;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; document?: string }>;
}) {
  const [query, config, recentDocuments, pendingSales] = await Promise.all([
    searchParams,
    Promise.resolve(getSiiConfig()),
    prisma.dteDocument.findMany({
      include: {
        sale: { select: { id: true, saleNumber: true, customerName: true, total: true } },
        _count: { select: { events: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.posSale.findMany({
      where: {
        dteDocuments: {
          none: {
            status: { notIn: [DteStatus.REJECTED, DteStatus.CANCELLED] },
            typeCode: { in: [33, 39] },
          },
        },
      },
      include: {
        shift: { include: { register: true, user: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  const readiness = getSiiReadiness(config);
  const accepted = recentDocuments.filter((item) => item.status === DteStatus.ACCEPTED).length;
  const pending = recentDocuments.filter((item) => isPendingStatus(item.status)).length;
  const problem = recentDocuments.filter((item) => isProblemStatus(item.status)).length;

  return (
    <div className="admin-content billing-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Chile · DTE</span>
          <h1>Facturación y boleta electrónica</h1>
          <p>Emisión, folios, trazabilidad y estados SII para ventas del punto de venta.</p>
        </div>
        <div className={`billing-environment is-${config.environment.toLowerCase()}`}>
          <span>Ambiente</span>
          <strong>{config.environment}</strong>
          <small>{config.provider}</small>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}{query.document && <> · <Link href={`/admin/facturacion/${query.document}`}>Ver DTE</Link></>}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="billing-readiness admin-card">
        <div>
          <span className={`billing-ready-dot${readiness.ready ? " is-ready" : ""}`} aria-hidden="true" />
          <div>
            <h2>{readiness.ready ? "Integración preparada" : "Configuración incompleta"}</h2>
            <p>{config.environment === "MOCK" ? "El ambiente MOCK simula aceptación y no envía documentos al SII." : "El envío real solo se habilita cuando todas las variables requeridas están configuradas."}</p>
          </div>
        </div>
        <div className="billing-readiness-meta">
          <span>SII_ENABLED: <strong>{config.enabled ? "true" : "false"}</strong></span>
          <span>Proveedor: <strong>{config.provider}</strong></span>
          <span>IVA: <strong>{config.vatRate}%</strong></span>
          <span>Boleta automática: <strong>{config.autoIssueBoleta ? "sí" : "no"}</strong></span>
        </div>
        {readiness.missing.length > 0 && <div className="billing-missing"><strong>Variables faltantes</strong><span>{readiness.missing.join(" · ")}</span></div>}
        {readiness.warnings.map((warning) => <div className="billing-warning" key={warning}>{warning}</div>)}
      </section>

      <section className="admin-stats-grid billing-stats">
        <div className="admin-stat"><strong>{recentDocuments.length}</strong><span>DTE recientes</span></div>
        <div className="admin-stat"><strong>{accepted}</strong><span>aceptados</span></div>
        <div className="admin-stat"><strong>{pending}</strong><span>pendientes</span></div>
        <div className="admin-stat"><strong>{problem}</strong><span>con observación/error</span></div>
      </section>

      <section className="admin-card billing-issue-section">
        <div className="admin-card-heading">
          <div><h2>Ventas pendientes de DTE</h2><p>Emite boleta o factura desde una venta ya registrada. La emisión no vuelve a descontar inventario.</p></div>
          <span className="billing-count">{pendingSales.length} pendientes</span>
        </div>

        {pendingSales.length === 0 ? (
          <div className="pos-empty">No hay ventas POS pendientes de documento tributario entre las últimas operaciones.</div>
        ) : (
          <div className="billing-sale-list">
            {pendingSales.map((sale) => (
              <article className="billing-sale-card" key={sale.id}>
                <div className="billing-sale-summary">
                  <div>
                    <strong>{sale.saleNumber}</strong>
                    <span>{sale.createdAt.toLocaleString("es-CL")}</span>
                    <small>{sale.shift?.register.name ?? "POS"} · {sale.shift?.user.name ?? sale.cashier}</small>
                    {sale.customerName && <small>{sale.customerName}{sale.customerRut ? ` · ${sale.customerRut}` : ""}</small>}
                  </div>
                  <strong className="billing-sale-total">{formatClp(sale.total)}</strong>
                </div>

                <div className="billing-sale-actions">
                  <form action={issuePosDteAction}>
                    <input type="hidden" name="saleId" value={sale.id} />
                    <input type="hidden" name="type" value={DteDocumentType.BOLETA_ELECTRONICA} />
                    <button className="admin-button admin-button-primary" type="submit">Emitir boleta 39</button>
                  </form>

                  <details className="billing-invoice-form">
                    <summary>Emitir factura 33</summary>
                    <form action={issuePosDteAction} className="admin-form">
                      <input type="hidden" name="saleId" value={sale.id} />
                      <input type="hidden" name="type" value={DteDocumentType.FACTURA_ELECTRONICA} />
                      <div className="billing-receiver-grid">
                        <label>RUT receptor<input name="receiverRut" required defaultValue={sale.customerRut ?? ""} placeholder="76123456-7" /></label>
                        <label>Razón social<input name="receiverName" required defaultValue={sale.customerName ?? ""} maxLength={191} /></label>
                        <label>Giro<input name="receiverGiro" required maxLength={191} /></label>
                        <label>Dirección<input name="receiverAddress" required maxLength={255} /></label>
                        <label>Comuna<input name="receiverCommune" required maxLength={120} /></label>
                        <label>Ciudad<input name="receiverCity" maxLength={120} /></label>
                      </div>
                      <button className="admin-button admin-button-primary" type="submit">Emitir factura electrónica</button>
                    </form>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-card billing-history">
        <div className="admin-card-heading"><div><h2>Historial DTE</h2><p>Últimos 100 documentos generados y su estado de integración.</p></div></div>
        <div className="admin-table-wrap">
          <table className="admin-table billing-table">
            <thead><tr><th>Fecha</th><th>Documento</th><th>Venta</th><th>Receptor</th><th>Total</th><th>Estado</th><th>Track ID</th><th>Acciones</th></tr></thead>
            <tbody>
              {recentDocuments.length === 0 && <tr><td colSpan={8}>Aún no hay documentos tributarios.</td></tr>}
              {recentDocuments.map((document) => (
                <tr key={document.id}>
                  <td>{document.createdAt.toLocaleString("es-CL")}</td>
                  <td><Link href={`/admin/facturacion/${document.id}`}><strong>{typeShort(document.type)} · F{document.folio}</strong></Link><small>{document.environment} · {document._count.events} eventos</small></td>
                  <td>{document.sale ? <Link href={`/admin/pos/ventas/${document.sale.id}`}>{document.sale.saleNumber}</Link> : "—"}</td>
                  <td>{document.receiverName ?? (document.typeCode === 39 ? "Consumidor final" : "—")}<small>{document.receiverRut ?? ""}</small></td>
                  <td><strong>{formatClp(document.totalAmount)}</strong></td>
                  <td><span className={`billing-status is-${document.status.toLowerCase()}`}>{statusLabel[document.status]}</span>{document.siiStatusCode && <small>{document.siiStatusCode}</small>}</td>
                  <td>{document.trackId ? <code>{document.trackId}</code> : "—"}</td>
                  <td>
                    <div className="billing-row-actions">
                      <Link href={`/admin/facturacion/${document.id}`} className="billing-link">Detalle</Link>
                      {document.trackId && <form action={syncDteStatusAction}><input type="hidden" name="documentId" value={document.id} /><button type="submit">Consultar</button></form>}
                      {isRetryableStatus(document.status) && <form action={retryDteAction}><input type="hidden" name="documentId" value={document.id} /><button type="submit">Reenviar</button></form>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="billing-legal-note">
        <strong>Alcance actual</strong>
        <span>El módulo implementa boleta electrónica tipo 39 y factura electrónica tipo 33 para ventas afectas. Los datos normativos/endpoints del SII no están codificados de forma fija: se cargan por variables de entorno y deben validarse en certificación antes de activar producción.</span>
      </div>
    </div>
  );
}
