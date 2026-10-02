"use server";

import { DteDocumentType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import {
  DteBillingError,
  issuePosSaleDte,
  retryDteSubmission,
  syncDteStatus,
} from "@/lib/sii/billing-service";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function statusUrl(type: "ok" | "error", message: string, documentId?: string): string {
  const params = new URLSearchParams({ [type]: message });
  if (documentId) params.set("document", documentId);
  return `/admin/facturacion?${params.toString()}`;
}

function refresh(documentId?: string, saleId?: string): void {
  revalidatePath("/admin/facturacion");
  revalidatePath("/admin/pos");
  revalidatePath("/admin/pos/reportes");
  if (documentId) revalidatePath(`/admin/facturacion/${documentId}`);
  if (saleId) revalidatePath(`/admin/pos/ventas/${saleId}`);
}

export async function issuePosDteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const saleId = text(formData, "saleId", 30);
  const rawType = text(formData, "type", 40);
  const type = rawType === DteDocumentType.FACTURA_ELECTRONICA
    ? DteDocumentType.FACTURA_ELECTRONICA
    : DteDocumentType.BOLETA_ELECTRONICA;

  if (!saleId) redirect(statusUrl("error", "Selecciona una venta POS para emitir el documento."));

  try {
    const document = await issuePosSaleDte({
      saleId,
      type,
      receiverRut: text(formData, "receiverRut", 20),
      receiverName: text(formData, "receiverName", 191),
      receiverGiro: text(formData, "receiverGiro", 191),
      receiverAddress: text(formData, "receiverAddress", 255),
      receiverCommune: text(formData, "receiverCommune", 120),
      receiverCity: text(formData, "receiverCity", 120),
    });
    refresh(document.id, saleId);
    redirect(statusUrl("ok", `${document.typeCode === 39 ? "Boleta" : "Factura"} folio ${document.folio} emitida en estado ${document.status}.`, document.id));
  } catch (error) {
    if (error instanceof DteBillingError) redirect(statusUrl("error", error.message));
    throw error;
  }
}

export async function retryDteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const documentId = text(formData, "documentId", 30);
  if (!documentId) redirect(statusUrl("error", "Documento inválido."));
  try {
    const document = await retryDteSubmission(documentId);
    refresh(document.id, document.saleId ?? undefined);
    redirect(statusUrl("ok", `Reenvío del folio ${document.folio}: ${document.status}.`, document.id));
  } catch (error) {
    if (error instanceof DteBillingError) redirect(statusUrl("error", error.message, documentId));
    throw error;
  }
}

export async function syncDteStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const documentId = text(formData, "documentId", 30);
  if (!documentId) redirect(statusUrl("error", "Documento inválido."));
  try {
    const document = await syncDteStatus(documentId);
    refresh(document.id, document.saleId ?? undefined);
    redirect(statusUrl("ok", `Estado actualizado: folio ${document.folio} · ${document.status}.`, document.id));
  } catch (error) {
    if (error instanceof DteBillingError) redirect(statusUrl("error", error.message, documentId));
    throw error;
  }
}
