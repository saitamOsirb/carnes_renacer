"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createProductionBatch,
  parseProductionProcessType,
  parseProductionWasteType,
  ProductionError,
  type ProductionInputLine,
  type ProductionOutputLine,
  type ProductionWasteLine,
} from "@/lib/production-service";
import { roundQuantity } from "@/lib/quantity";

function text(formData: FormData, key: string, max = 1000): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function statusUrl(path: string, type: "ok" | "error", message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${type}=${encodeURIComponent(message)}`;
}

function parseJsonArray(raw: string, label: string): Array<Record<string, unknown>> {
  if (!raw || raw.length > 200_000) throw new ProductionError(`${label}: datos inválidos.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProductionError(`${label}: no fue posible interpretar los datos.`);
  }
  if (!Array.isArray(parsed)) throw new ProductionError(`${label}: formato inválido.`);
  return parsed.map((entry) => (typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {}));
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseInputs(raw: string): ProductionInputLine[] {
  return parseJsonArray(raw, "Entradas").map((entry) => ({
    lotId: typeof entry.lotId === "string" ? entry.lotId : "",
    quantity: roundQuantity(Number(entry.quantity)),
  }));
}

function parseOutputs(raw: string): ProductionOutputLine[] {
  return parseJsonArray(raw, "Salidas").map((entry) => ({
    productId: typeof entry.productId === "string" ? entry.productId : "",
    quantity: roundQuantity(Number(entry.quantity)),
    manufacturedAt: parseDate(entry.manufacturedAt),
    expirationDate: parseDate(entry.expirationDate),
  }));
}

function parseWastes(raw: string): ProductionWasteLine[] {
  if (!raw) return [];
  return parseJsonArray(raw, "Mermas").map((entry) => ({
    type: parseProductionWasteType(typeof entry.type === "string" ? entry.type : ""),
    quantity: roundQuantity(Number(entry.quantity)),
    sourceProductId: typeof entry.sourceProductId === "string" ? entry.sourceProductId : null,
    note: typeof entry.note === "string" ? entry.note : null,
  })).filter((entry) => entry.quantity > 0);
}

function refreshProduction(): void {
  revalidatePath("/admin/produccion");
  revalidatePath("/admin/lotes");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/pos");
  revalidatePath("/");
}

export async function createProductionAction(formData: FormData): Promise<void> {
  await requireAdmin();
  let batchId = "";
  let productionNumber = "";
  try {
    const batch = await createProductionBatch({
      requestKey: text(formData, "requestKey", 64),
      warehouseId: text(formData, "warehouseId", 30),
      processType: parseProductionProcessType(text(formData, "processType", 40)),
      performedBy: text(formData, "performedBy", 80) || process.env.ADMIN_USERNAME?.trim() || "admin",
      notes: text(formData, "notes", 1000),
      inputs: parseInputs(text(formData, "inputsJson", 200_000)),
      outputs: parseOutputs(text(formData, "outputsJson", 200_000)),
      wastes: parseWastes(text(formData, "wastesJson", 200_000)),
    });
    batchId = batch.id;
    productionNumber = batch.productionNumber;
  } catch (error) {
    const message = error instanceof ProductionError
      ? error.message
      : "No fue posible registrar la producción. Revisa existencias, lotes y cantidades.";
    redirect(statusUrl("/admin/produccion", "error", message));
  }

  refreshProduction();
  revalidatePath(`/admin/produccion/${batchId}`);
  redirect(statusUrl(`/admin/produccion/${batchId}`, "ok", `${productionNumber} registrada correctamente.`));
}
