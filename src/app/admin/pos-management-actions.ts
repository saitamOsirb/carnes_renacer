"use server";

import { PosCashMovementType, PosShiftStatus, PosUserRole, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { hashPosPin, validatePosPin, verifyPosPin } from "@/lib/pos-security";
import { calculateShiftCash } from "@/lib/pos-shift-service";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(formData: FormData, key: string, min = 0, max = 999_999_999): number | null {
  const raw = text(formData, key, 30);
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function normalizeCode(value: string, max = 40): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(0, 80);
}

function posUrl(type: "ok" | "error", message: string, shiftId?: string): string {
  const params = new URLSearchParams({ [type]: message });
  if (shiftId) params.set("shift", shiftId);
  return `/admin/pos?${params.toString()}`;
}

function configUrl(type: "ok" | "error", message: string): string {
  return `/admin/pos/configuracion?${type}=${encodeURIComponent(message)}`;
}

function refreshPos(): void {
  revalidatePath("/admin/pos");
  revalidatePath("/admin/pos/configuracion");
  revalidatePath("/admin/pos/reportes");
}

export async function createPosUser(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = text(formData, "name", 191);
  const username = normalizeUsername(text(formData, "username", 80));
  const pin = text(formData, "pin", 20);
  const role = text(formData, "role", 20) === "MANAGER" ? PosUserRole.MANAGER : PosUserRole.CASHIER;

  if (name.length < 2 || username.length < 3 || !validatePosPin(pin)) {
    redirect(configUrl("error", "Completa nombre, usuario y un PIN numérico de 4 a 12 dígitos."));
  }
  if (await prisma.posUser.findUnique({ where: { username }, select: { id: true } })) {
    redirect(configUrl("error", `El usuario ${username} ya existe.`));
  }

  await prisma.posUser.create({ data: { name, username, pinHash: hashPosPin(pin), role, active: true } });
  refreshPos();
  redirect(configUrl("ok", `Usuario POS ${name} creado.`));
}

export async function updatePosUser(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const current = await prisma.posUser.findUnique({ where: { id } });
  if (!current) redirect(configUrl("error", "Usuario POS no encontrado."));

  const name = text(formData, "name", 191);
  const username = normalizeUsername(text(formData, "username", 80));
  const pin = text(formData, "pin", 20);
  const active = formData.get("active") === "on";
  const role = text(formData, "role", 20) === "MANAGER" ? PosUserRole.MANAGER : PosUserRole.CASHIER;
  if (name.length < 2 || username.length < 3 || (pin && !validatePosPin(pin))) {
    redirect(configUrl("error", "Datos de usuario POS inválidos."));
  }
  const duplicate = await prisma.posUser.findUnique({ where: { username }, select: { id: true } });
  if (duplicate && duplicate.id !== id) redirect(configUrl("error", `El usuario ${username} ya existe.`));
  if (!active) {
    const openShift = await prisma.posShift.findFirst({ where: { userId: id, status: PosShiftStatus.OPEN }, select: { id: true } });
    if (openShift) redirect(configUrl("error", "Cierra el turno del cajero antes de desactivarlo."));
  }

  await prisma.posUser.update({
    where: { id },
    data: { name, username, role, active, ...(pin ? { pinHash: hashPosPin(pin) } : {}) },
  });
  refreshPos();
  redirect(configUrl("ok", `Usuario POS ${name} actualizado.`));
}

export async function createCashRegister(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = text(formData, "name", 191);
  const code = normalizeCode(text(formData, "code", 40));
  const warehouseId = text(formData, "warehouseId", 30);
  if (name.length < 2 || code.length < 2 || !warehouseId) redirect(configUrl("error", "Completa código, nombre y bodega de la caja."));
  if (await prisma.cashRegister.findUnique({ where: { code }, select: { id: true } })) redirect(configUrl("error", `La caja ${code} ya existe.`));
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse?.active) redirect(configUrl("error", "La bodega seleccionada no está activa."));

  await prisma.cashRegister.create({ data: { code, name, warehouseId, active: true } });
  refreshPos();
  redirect(configUrl("ok", `Caja ${name} creada.`));
}

export async function updateCashRegister(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const current = await prisma.cashRegister.findUnique({ where: { id } });
  if (!current) redirect(configUrl("error", "Caja no encontrada."));

  const name = text(formData, "name", 191);
  const code = normalizeCode(text(formData, "code", 40));
  const warehouseId = text(formData, "warehouseId", 30);
  const active = formData.get("active") === "on";
  if (name.length < 2 || code.length < 2 || !warehouseId) redirect(configUrl("error", "Datos de caja inválidos."));
  const duplicate = await prisma.cashRegister.findUnique({ where: { code }, select: { id: true } });
  if (duplicate && duplicate.id !== id) redirect(configUrl("error", `El código ${code} ya está en uso.`));
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse?.active) redirect(configUrl("error", "La bodega seleccionada no está activa."));
  const openShift = await prisma.posShift.findFirst({ where: { registerId: id, status: PosShiftStatus.OPEN }, select: { id: true } });
  if (openShift && (!active || warehouseId !== current.warehouseId)) {
    redirect(configUrl("error", "Cierra el turno abierto antes de desactivar la caja o cambiar su bodega."));
  }

  await prisma.cashRegister.update({ where: { id }, data: { name, code, warehouseId, active } });
  refreshPos();
  redirect(configUrl("ok", `Caja ${name} actualizada.`));
}

export async function openPosShift(formData: FormData): Promise<void> {
  await requireAdmin();
  const registerId = text(formData, "registerId", 30);
  const userId = text(formData, "userId", 30);
  const pin = text(formData, "pin", 20);
  const openingAmount = integer(formData, "openingAmount", 0);
  const openingNotes = text(formData, "openingNotes", 500);
  if (!registerId || !userId || openingAmount === null) redirect(posUrl("error", "Datos de apertura inválidos."));

  let shiftId = "";
  try {
    shiftId = await prisma.$transaction(async (tx) => {
      const [register, user] = await Promise.all([
        tx.cashRegister.findUnique({ where: { id: registerId }, include: { warehouse: true } }),
        tx.posUser.findUnique({ where: { id: userId } }),
      ]);
      if (!register?.active || !register.warehouse.active) throw new Error("REGISTER_INACTIVE");
      if (!user?.active || !verifyPosPin(pin, user.pinHash)) throw new Error("INVALID_PIN");

      const conflicting = await tx.posShift.findFirst({
        where: { status: PosShiftStatus.OPEN, OR: [{ registerId }, { userId }] },
        include: { register: true, user: true },
      });
      if (conflicting) throw new Error(`OPEN_CONFLICT:${conflicting.register.name}:${conflicting.user.name}`);

      const shift = await tx.posShift.create({
        data: { registerId, userId, openingAmount, openingNotes: openingNotes || null },
      });
      return shift.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTER_INACTIVE") redirect(posUrl("error", "La caja o su bodega no están activas."));
    if (error instanceof Error && error.message === "INVALID_PIN") redirect(posUrl("error", "Usuario POS o PIN incorrecto."));
    if (error instanceof Error && error.message.startsWith("OPEN_CONFLICT:")) {
      const [, registerName, userName] = error.message.split(":");
      redirect(posUrl("error", `Ya existe un turno abierto en ${registerName} o para ${userName}.`));
    }
    throw error;
  }

  refreshPos();
  redirect(posUrl("ok", "Caja abierta correctamente.", shiftId));
}

export async function addPosCashMovement(formData: FormData): Promise<void> {
  await requireAdmin();
  const shiftId = text(formData, "shiftId", 30);
  const type = text(formData, "type", 20) === "CASH_OUT" ? PosCashMovementType.CASH_OUT : PosCashMovementType.CASH_IN;
  const amount = integer(formData, "amount", 1);
  const reason = text(formData, "reason", 500);
  if (!shiftId || amount === null || reason.length < 3) redirect(posUrl("error", "Completa monto y motivo del movimiento.", shiftId));

  try {
    await prisma.$transaction(async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new Error("SHIFT_CLOSED");
      if (type === PosCashMovementType.CASH_OUT) {
        const summary = await calculateShiftCash(tx, shift.id, shift.openingAmount);
        if (amount > summary.expectedCash) throw new Error("INSUFFICIENT_CASH");
      }
      await tx.posCashMovement.create({ data: { shiftId, type, amount, reason } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "SHIFT_CLOSED") redirect(posUrl("error", "El turno ya está cerrado."));
    if (error instanceof Error && error.message === "INSUFFICIENT_CASH") redirect(posUrl("error", "El retiro supera el efectivo esperado en caja.", shiftId));
    throw error;
  }

  refreshPos();
  redirect(posUrl("ok", type === PosCashMovementType.CASH_IN ? "Ingreso de efectivo registrado." : "Retiro de efectivo registrado.", shiftId));
}

export async function closePosShift(formData: FormData): Promise<void> {
  await requireAdmin();
  const shiftId = text(formData, "shiftId", 30);
  const pin = text(formData, "pin", 20);
  const declaredCash = integer(formData, "declaredCash", 0);
  const closingNotes = text(formData, "closingNotes", 500);
  if (!shiftId || declaredCash === null) redirect(posUrl("error", "Completa el efectivo contado para cerrar la caja.", shiftId));

  let difference = 0;
  let expectedCash = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: shiftId }, include: { user: true } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new Error("SHIFT_CLOSED");
      if (!verifyPosPin(pin, shift.user.pinHash)) throw new Error("INVALID_PIN");

      const summary = await calculateShiftCash(tx, shift.id, shift.openingAmount);
      expectedCash = summary.expectedCash;
      difference = declaredCash - expectedCash;
      await tx.posShift.update({
        where: { id: shift.id },
        data: {
          status: PosShiftStatus.CLOSED,
          expectedCash,
          declaredCash,
          difference,
          closingNotes: closingNotes || null,
          closedAt: new Date(),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Error && error.message === "SHIFT_CLOSED") redirect(posUrl("error", "El turno ya está cerrado."));
    if (error instanceof Error && error.message === "INVALID_PIN") redirect(posUrl("error", "PIN del cajero incorrecto.", shiftId));
    throw error;
  }

  refreshPos();
  const detail = difference === 0 ? "sin diferencias" : `diferencia ${difference > 0 ? "+" : ""}$${difference.toLocaleString("es-CL")}`;
  redirect(posUrl("ok", `Caja cerrada. Efectivo esperado $${expectedCash.toLocaleString("es-CL")}; ${detail}.`));
}
