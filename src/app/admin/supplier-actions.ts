"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeCode(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeRut(value: string): string {
  const cleaned = value.replace(/[^0-9kK]/g, "").toUpperCase();
  if (cleaned.length < 2) return "";
  return `${cleaned.slice(0, -1)}-${cleaned.slice(-1)}`;
}

function validRut(value: string): boolean {
  const normalized = normalizeRut(value);
  const [body, verifier] = normalized.split("-");
  if (!body || !verifier || !/^\d+$/.test(body)) return false;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  const expected = result === 11 ? "0" : result === 10 ? "K" : String(result);
  return verifier === expected;
}

function intValue(formData: FormData, key: string, min: number, max: number): number | null {
  const raw = text(formData, key, 20);
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function statusUrl(type: "ok" | "error", message: string): string {
  return `/admin/proveedores?${type}=${encodeURIComponent(message)}`;
}

function refresh(): void {
  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/compras");
}

export async function createSupplierAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const code = normalizeCode(text(formData, "code", 40));
  const name = text(formData, "name", 191);
  const rutRaw = text(formData, "rut", 20);
  const rut = rutRaw ? normalizeRut(rutRaw) : null;
  const paymentTermsDays = intValue(formData, "paymentTermsDays", 0, 3650);

  if (code.length < 2 || name.length < 2 || paymentTermsDays === null) {
    redirect(statusUrl("error", "Código, nombre o plazo de pago inválido."));
  }
  if (rutRaw && !validRut(rutRaw)) redirect(statusUrl("error", "El RUT del proveedor no es válido."));

  const duplicate = await prisma.supplier.findFirst({
    where: {
      OR: [
        { code },
        ...(rut ? [{ rut }] : []),
      ],
    },
    select: { code: true, rut: true },
  });
  if (duplicate) redirect(statusUrl("error", "Ya existe un proveedor con ese código o RUT."));

  await prisma.supplier.create({
    data: {
      code,
      rut,
      name,
      contactName: text(formData, "contactName", 191) || null,
      email: text(formData, "email", 191) || null,
      phone: text(formData, "phone", 40) || null,
      address: text(formData, "address", 255) || null,
      commune: text(formData, "commune", 120) || null,
      city: text(formData, "city", 120) || null,
      paymentTermsDays,
      notes: text(formData, "notes", 1000) || null,
      active: true,
    },
  });
  refresh();
  redirect(statusUrl("ok", `Proveedor ${name} creado correctamente.`));
}

export async function updateSupplierAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const current = await prisma.supplier.findUnique({ where: { id } });
  if (!current) redirect(statusUrl("error", "Proveedor no encontrado."));

  const code = normalizeCode(text(formData, "code", 40));
  const name = text(formData, "name", 191);
  const rutRaw = text(formData, "rut", 20);
  const rut = rutRaw ? normalizeRut(rutRaw) : null;
  const paymentTermsDays = intValue(formData, "paymentTermsDays", 0, 3650);
  if (code.length < 2 || name.length < 2 || paymentTermsDays === null) {
    redirect(statusUrl("error", "Código, nombre o plazo de pago inválido."));
  }
  if (rutRaw && !validRut(rutRaw)) redirect(statusUrl("error", "El RUT del proveedor no es válido."));

  const duplicate = await prisma.supplier.findFirst({
    where: {
      id: { not: id },
      OR: [
        { code },
        ...(rut ? [{ rut }] : []),
      ],
    },
    select: { id: true },
  });
  if (duplicate) redirect(statusUrl("error", "Otro proveedor ya usa ese código o RUT."));

  await prisma.supplier.update({
    where: { id },
    data: {
      code,
      rut,
      name,
      contactName: text(formData, "contactName", 191) || null,
      email: text(formData, "email", 191) || null,
      phone: text(formData, "phone", 40) || null,
      address: text(formData, "address", 255) || null,
      commune: text(formData, "commune", 120) || null,
      city: text(formData, "city", 120) || null,
      paymentTermsDays,
      notes: text(formData, "notes", 1000) || null,
      active: formData.get("active") === "on",
    },
  });
  refresh();
  redirect(statusUrl("ok", `Proveedor ${name} actualizado.`));
}
