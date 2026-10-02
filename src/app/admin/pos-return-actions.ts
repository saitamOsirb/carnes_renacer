"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createPosReturn,
  PosReturnError,
  type PosReturnLineInput,
} from "@/lib/pos-return-service";
import {
  DteBillingError,
  issuePosReturnCreditNote,
} from "@/lib/sii/billing-service";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function saleUrl(saleId: string, type: "ok" | "error", message: string, returnId?: string): string {
  const params = new URLSearchParams({ [type]: message });
  if (returnId) params.set("return", returnId);
  return `/admin/pos/ventas/${saleId}?${params.toString()}`;
}

function parseReturnItems(formData: FormData): PosReturnLineInput[] {
  const items: PosReturnLineInput[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("qty_") || typeof raw !== "string") continue;
    const saleItemId = key.slice(4, 34);
    const quantity = Number(raw.replace(",", "."));
    if (Number.isFinite(quantity) && quantity > 0) items.push({ saleItemId, quantity });
  }
  return items;
}

function refreshReturnPaths(saleId: string, documentId?: string): void {
  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/carrito");
  revalidatePath("/checkout");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
  revalidatePath("/admin/pos");
  revalidatePath("/admin/pos/reportes");
  revalidatePath("/admin/facturacion");
  revalidatePath(`/admin/pos/ventas/${saleId}`);
  if (documentId) revalidatePath(`/admin/facturacion/${documentId}`);
}

export async function createPosReturnAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const saleId = text(formData, "saleId", 30);
  const shiftId = text(formData, "shiftId", 30);
  const requestKey = text(formData, "requestKey", 64);
  const reason = text(formData, "reason", 500);
  const items = parseReturnItems(formData);

  if (!saleId) redirect("/admin/pos?error=Venta%20inv%C3%A1lida");

  let posReturn;
  try {
    posReturn = await createPosReturn({ saleId, shiftId, requestKey, reason, items });
  } catch (error) {
    if (error instanceof PosReturnError) redirect(saleUrl(saleId, "error", error.message));
    throw error;
  }

  let message = `Devolución ${posReturn.returnNumber} registrada por $${posReturn.totalAmount.toLocaleString("es-CL")}.`;
  let documentId: string | undefined;
  if (formData.get("issueCreditNote") === "on") {
    try {
      const document = await issuePosReturnCreditNote({ returnId: posReturn.id });
      documentId = document.id;
      message += ` Nota de crédito folio ${document.folio}: ${document.status}.`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "error desconocido";
      message += ` La devolución quedó confirmada, pero la nota de crédito quedó pendiente: ${detail}`;
    }
  }

  refreshReturnPaths(saleId, documentId);
  redirect(saleUrl(saleId, "ok", message, posReturn.id));
}

export async function issuePosReturnCreditNoteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const saleId = text(formData, "saleId", 30);
  const returnId = text(formData, "returnId", 30);
  const parentDocumentId = text(formData, "parentDocumentId", 30) || undefined;
  if (!saleId || !returnId) redirect("/admin/facturacion?error=Devoluci%C3%B3n%20inv%C3%A1lida");

  try {
    const document = await issuePosReturnCreditNote({ returnId, parentDocumentId });
    refreshReturnPaths(saleId, document.id);
    redirect(saleUrl(saleId, "ok", `Nota de crédito folio ${document.folio} emitida en estado ${document.status}.`, returnId));
  } catch (error) {
    if (error instanceof DteBillingError) redirect(saleUrl(saleId, "error", error.message, returnId));
    throw error;
  }
}
