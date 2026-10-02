import Link from "next/link";
import { DteStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { retryDteAction, syncDteStatusAction } from "@/app/admin/billing-actions";
import { PrintButton } from "@/components/admin/print-button";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { dteTypeLabel } from "@/lib/sii/billing-service";

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

export default async function DteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.dteDocument.findUnique({
    where: { id },
    include: {
      sale: {
        include: {
          items: { orderBy: { productName: "asc" } },
          shift: { include: { register: true, user: true } },
        },
      },
      events: { orderBy: { createdAt: "desc" } },
      parent: true,
      references: true,
    },
  });
  if (!document) notFound();

  const retryable = document.status === DteStatus.ERROR
    || document.status === DteStatus.GENERATED
    || document.status === DteStatus.QUEUED;

  return (
    <div className="admin-content admin-content-narrow billing-detail-page">
      <div className="billing-detail-actions no-print">
        <Link href="/admin/facturacion" className="admin-button admin-button-secondary">← Facturación</Link>
        <div>
          {document.trackId && <form action={syncDteStatusAction}><input type="hidden" name="documentId" value={document.id} /><button className="admin-button admin-button-secondary" type="submit">Consultar estado SII</button></form>}
          {retryable && <form action={retryDteAction}><input type="hidden" name="documentId" value={document.id} /><button className="admin-button admin-button-secondary" type="submit">Reenviar</button></form>}
          <PrintButton />
        </div>
      </div>

      <article className="billing-document-print">
        <header className="billing-document-header">
          <div>
            <span>Renacer Distribuidora</span>
            <h1>{dteTypeLabel(document.type)}</h1>
            <strong>Tipo {document.typeCode} · Folio {document.folio}</strong>
          </div>
          <div className={`billing-document-stamp is-${document.status.toLowerCase()}`}>
            <span>{document.environment}</span>
            <strong>{statusLabel[document.status]}</strong>
          </div>
        </header>

        <section className="billing-document-meta">
          <div><span>Fecha emisión</span><strong>{document.issueDate.toLocaleString("es-CL")}</strong></div>
          <div><span>Venta origen</span><strong>{document.sale?.saleNumber ?? "Sin venta asociada"}</strong></div>
          <div><span>Track ID</span><strong>{document.trackId ?? "Pendiente"}</strong></div>
          <div><span>Código SII/proveedor</span><strong>{document.siiStatusCode ?? "—"}</strong></div>
        </section>

        <section className="billing-document-receiver">
          <h2>{document.typeCode === 39 ? "Receptor" : "Datos receptor"}</h2>
          {document.receiverRut ? (
            <div className="billing-receiver-detail">
              <div><span>RUT</span><strong>{document.receiverRut}</strong></div>
              <div><span>Razón social</span><strong>{document.receiverName ?? "—"}</strong></div>
              <div><span>Giro</span><strong>{document.receiverGiro ?? "—"}</strong></div>
              <div><span>Dirección</span><strong>{document.receiverAddress ?? "—"}</strong></div>
              <div><span>Comuna / ciudad</span><strong>{[document.receiverCommune, document.receiverCity].filter(Boolean).join(" · ") || "—"}</strong></div>
            </div>
          ) : <p>Consumidor final / receptor no individualizado.</p>}
        </section>

        {document.sale && <section className="billing-document-lines">
          <div className="billing-document-row is-head"><span>Producto</span><span>Cant.</span><span>Precio</span><span>Total</span></div>
          {document.sale.items.map((item) => (
            <div className="billing-document-row" key={item.id}>
              <span><strong>{item.productName}</strong><small>{item.unit === "KG" ? "kg" : "unidad"}</small></span>
              <span>{item.quantity}</span>
              <span>{formatClp(item.unitPrice)}</span>
              <span>{formatClp(item.subtotal)}</span>
            </div>
          ))}
          {document.sale.discount > 0 && <div className="billing-document-discount"><span>Descuento venta</span><strong>−{formatClp(document.sale.discount)}</strong></div>}
        </section>}

        <section className="billing-document-totals">
          <div><span>Monto neto</span><strong>{formatClp(document.netAmount)}</strong></div>
          {document.exemptAmount > 0 && <div><span>Monto exento</span><strong>{formatClp(document.exemptAmount)}</strong></div>}
          <div><span>IVA {document.vatRate}%</span><strong>{formatClp(document.vatAmount)}</strong></div>
          <div className="is-total"><span>Total</span><strong>{formatClp(document.totalAmount)}</strong></div>
        </section>

        {document.siiStatusMessage && <section className="billing-document-message"><strong>Respuesta integración</strong><p>{document.siiStatusMessage}</p></section>}
        {document.errorMessage && <section className="billing-document-message is-error"><strong>Error</strong><p>{document.errorMessage}</p></section>}

        <footer>
          {document.environment === "MOCK"
            ? "SIMULACIÓN INTERNA · Este documento no fue enviado al SII."
            : "Representación administrativa del DTE. Verifica aceptación y XML firmado antes de usar como respaldo tributario."}
        </footer>
      </article>

      <section className="admin-card billing-events no-print">
        <div className="admin-card-heading"><div><h2>Bitácora del documento</h2><p>Cada generación, envío, consulta y respuesta queda registrada.</p></div></div>
        <div className="billing-event-list">
          {document.events.map((event) => (
            <article key={event.id}>
              <div><span className={`billing-status is-${event.status.toLowerCase()}`}>{statusLabel[event.status]}</span><strong>{event.createdAt.toLocaleString("es-CL")}</strong></div>
              <p>{event.message}</p>
              {event.code && <code>{event.code}</code>}
            </article>
          ))}
        </div>
      </section>

      <section className="admin-card billing-xml-card no-print">
        <div className="admin-card-heading"><div><h2>XML y respuesta técnica</h2><p>Solo para auditoría y diagnóstico. No contiene las credenciales del certificado.</p></div></div>
        <details open={!document.xmlSigned}><summary>XML de trabajo</summary><pre>{document.xmlDraft ?? "Sin XML generado."}</pre></details>
        {document.xmlSigned && <details><summary>XML firmado devuelto por el proveedor</summary><pre>{document.xmlSigned}</pre></details>}
        {document.responseRaw && <details><summary>Respuesta cruda del proveedor/SII</summary><pre>{document.responseRaw}</pre></details>}
      </section>
    </div>
  );
}
