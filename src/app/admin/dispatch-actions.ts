"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import {
  cancelDispatch,
  createInternalTransferDispatch,
  createSaleDispatch,
  DispatchError,
  markDispatchDispatched,
  markDispatchReceived,
  type CreateTransferDispatchInput,
} from "@/lib/dispatch-service";
import { DteBillingError, issueDispatchGuideDte } from "@/lib/sii/billing-service";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function url(type: "ok" | "error", message: string, id?: string): string {
  const params = new URLSearchParams({ [type]: message });
  if (id) params.set("dispatch", id);
  return `/admin/despachos?${params.toString()}`;
}

function refresh(id?: string): void {
  revalidatePath("/admin/despachos");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
  revalidatePath("/admin/facturacion");
  revalidatePath("/admin/productos");
  if (id) revalidatePath(`/admin/despachos/${id}`);
}

function transportFields(formData: FormData) {
  return {
    transferReasonCode: text(formData, "transferReasonCode", 10) || undefined,
    reason: text(formData, "reason", 500),
    receiverRut: text(formData, "receiverRut", 20) || undefined,
    receiverName: text(formData, "receiverName", 191),
    receiverGiro: text(formData, "receiverGiro", 191) || undefined,
    receiverAddress: text(formData, "receiverAddress", 255),
    receiverCommune: text(formData, "receiverCommune", 120),
    receiverCity: text(formData, "receiverCity", 120) || undefined,
    transportCompanyRut: text(formData, "transportCompanyRut", 20) || undefined,
    transportCompanyName: text(formData, "transportCompanyName", 191) || undefined,
    driverRut: text(formData, "driverRut", 20) || undefined,
    driverName: text(formData, "driverName", 191) || undefined,
    vehiclePlate: text(formData, "vehiclePlate", 20) || undefined,
    trailerPlate: text(formData, "trailerPlate", 20) || undefined,
    notes: text(formData, "notes", 1000) || undefined,
  };
}

function parseTransferItems(raw: string): CreateTransferDispatchInput["items"] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => {
      const item = value as { productId?: unknown; quantity?: unknown };
      return {
        productId: typeof item.productId === "string" ? item.productId : "",
        quantity: Number(item.quantity),
      };
    });
  } catch {
    return [];
  }
}

export async function createSaleDispatchAction(formData: FormData): Promise<void> {
  await requireAdmin();
  try {
    const dispatch = await createSaleDispatch({
      requestKey: text(formData, "requestKey", 64),
      saleId: text(formData, "saleId", 30),
      ...transportFields(formData),
    });
    refresh(dispatch.id);
    redirect(`/admin/despachos/${dispatch.id}?ok=${encodeURIComponent(`Despacho ${dispatch.dispatchNumber} creado.`)}`);
  } catch (error) {
    if (error instanceof DispatchError) redirect(url("error", error.message));
    throw error;
  }
}

export async function createTransferDispatchAction(formData: FormData): Promise<void> {
  await requireAdmin();
  try {
    const dispatch = await createInternalTransferDispatch({
      requestKey: text(formData, "requestKey", 64),
      sourceWarehouseId: text(formData, "sourceWarehouseId", 30),
      destinationWarehouseId: text(formData, "destinationWarehouseId", 30),
      items: parseTransferItems(text(formData, "items", 30_000)),
      ...transportFields(formData),
    });
    refresh(dispatch.id);
    redirect(`/admin/despachos/${dispatch.id}?ok=${encodeURIComponent(`Traslado ${dispatch.dispatchNumber} creado.`)}`);
  } catch (error) {
    if (error instanceof DispatchError) redirect(url("error", error.message));
    throw error;
  }
}

export async function issueDispatchGuideAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const dispatchId = text(formData, "dispatchId", 30);
  try {
    const document = await issueDispatchGuideDte({
      dispatchId,
      parentDocumentId: text(formData, "parentDocumentId", 30) || undefined,
    });
    refresh(dispatchId);
    revalidatePath(`/admin/facturacion/${document.id}`);
    redirect(`/admin/despachos/${dispatchId}?ok=${encodeURIComponent(`Guía 52 folio ${document.folio}: ${document.status}.`)}`);
  } catch (error) {
    if (error instanceof DteBillingError) redirect(`/admin/despachos/${dispatchId}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
}

export async function markDispatchDispatchedAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const dispatchId = text(formData, "dispatchId", 30);
  try {
    const dispatch = await markDispatchDispatched(dispatchId, "admin");
    refresh(dispatch.id);
    redirect(`/admin/despachos/${dispatch.id}?ok=${encodeURIComponent(`${dispatch.dispatchNumber} marcado como despachado.`)}`);
  } catch (error) {
    if (error instanceof DispatchError) redirect(`/admin/despachos/${dispatchId}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
}

export async function markDispatchReceivedAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const dispatchId = text(formData, "dispatchId", 30);
  try {
    const dispatch = await markDispatchReceived(dispatchId);
    refresh(dispatch.id);
    redirect(`/admin/despachos/${dispatch.id}?ok=${encodeURIComponent(`${dispatch.dispatchNumber} recibido correctamente.`)}`);
  } catch (error) {
    if (error instanceof DispatchError) redirect(`/admin/despachos/${dispatchId}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
}

export async function cancelDispatchAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const dispatchId = text(formData, "dispatchId", 30);
  try {
    const dispatch = await cancelDispatch(dispatchId);
    refresh(dispatch.id);
    redirect(`/admin/despachos/${dispatch.id}?ok=${encodeURIComponent(`${dispatch.dispatchNumber} cancelado.`)}`);
  } catch (error) {
    if (error instanceof DispatchError) redirect(`/admin/despachos/${dispatchId}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
}
