"use server";

import { CustomerConsentKind, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { CUSTOMER_PRIVACY_NOTICE_VERSION } from "@/lib/customer-privacy";
import { prisma } from "@/lib/prisma";
import { formatRut, validateRut } from "@/lib/rut";

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function customerUrl(type: "ok" | "error", message: string): string {
  return `/admin/clientes?${type}=${encodeURIComponent(message)}`;
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function normalizePhone(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[^0-9+]/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return normalized.slice(0, 40);
}

function parseRut(value: string): { value: string | null; valid: boolean } {
  const raw = value.trim();
  if (!raw) return { value: null, valid: true };
  if (!validateRut(raw)) return { value: null, valid: false };
  return { value: formatRut(raw), valid: true };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function refreshCustomers(): void {
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/pos");
  revalidatePath("/admin/pos/reportes");
}

export async function createCustomer(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = text(formData, "name", 191);
  const rut = parseRut(text(formData, "rut", 20));
  const rawEmail = text(formData, "email", 191);
  const rawPhone = text(formData, "phone", 40);
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  const address = text(formData, "address", 255) || null;
  const privacyAcknowledged = formData.get("privacyAcknowledged") === "on";
  const marketingConsent = formData.get("marketingConsent") === "on";

  if (name.length < 2) redirect(customerUrl("error", "Ingresa un nombre válido para el cliente."));
  if (!rut.valid) redirect(customerUrl("error", "El RUT ingresado no es válido."));
  if (rawEmail && !email) redirect(customerUrl("error", "El correo electrónico no tiene un formato válido."));
  if (rawPhone && !phone) redirect(customerUrl("error", "El teléfono debe contener entre 8 y 15 dígitos."));
  if (!privacyAcknowledged) redirect(customerUrl("error", "Debes confirmar que el cliente fue informado del aviso de privacidad antes de crear el perfil."));
  if (marketingConsent && !email && !phone) redirect(customerUrl("error", "Para autorizar comunicaciones comerciales debe existir al menos un correo o teléfono de contacto."));

  if (rut.value) {
    const duplicate = await prisma.customer.findUnique({ where: { rut: rut.value }, select: { id: true } });
    if (duplicate) redirect(customerUrl("error", `Ya existe un cliente registrado con el RUT ${rut.value}.`));
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name,
          rut: rut.value,
          email,
          phone,
          address,
          active: true,
          privacyNoticeVersion: CUSTOMER_PRIVACY_NOTICE_VERSION,
          privacyAcknowledgedAt: now,
          privacySource: "ADMIN_CUSTOMER_REGISTRY",
          marketingConsent,
          marketingConsentAt: marketingConsent ? now : null,
          marketingConsentSource: "ADMIN_CUSTOMER_REGISTRY",
        },
      });

      await tx.customerConsentEvent.createMany({
        data: [
          {
            customerId: customer.id,
            kind: CustomerConsentKind.PRIVACY_NOTICE,
            granted: true,
            noticeVersion: CUSTOMER_PRIVACY_NOTICE_VERSION,
            source: "ADMIN_CUSTOMER_REGISTRY",
          },
          {
            customerId: customer.id,
            kind: CustomerConsentKind.MARKETING,
            granted: marketingConsent,
            noticeVersion: CUSTOMER_PRIVACY_NOTICE_VERSION,
            source: "ADMIN_CUSTOMER_REGISTRY",
          },
        ],
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isUniqueConstraintError(error)) redirect(customerUrl("error", "Ya existe un cliente con uno de los identificadores únicos ingresados."));
    throw error;
  }

  refreshCustomers();
  redirect(customerUrl("ok", `Cliente ${name} registrado correctamente.`));
}

export async function updateCustomer(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const current = await prisma.customer.findUnique({ where: { id } });
  if (!current) redirect(customerUrl("error", "Cliente no encontrado."));
  if (current.anonymizedAt) redirect(customerUrl("error", "Un cliente anonimizado no puede volver a editarse."));

  const name = text(formData, "name", 191);
  const rut = parseRut(text(formData, "rut", 20));
  const rawEmail = text(formData, "email", 191);
  const rawPhone = text(formData, "phone", 40);
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  const address = text(formData, "address", 255) || null;
  const active = formData.get("active") === "on";
  const marketingConsent = formData.get("marketingConsent") === "on";

  if (name.length < 2) redirect(customerUrl("error", "Ingresa un nombre válido para el cliente."));
  if (!rut.valid) redirect(customerUrl("error", "El RUT ingresado no es válido."));
  if (rawEmail && !email) redirect(customerUrl("error", "El correo electrónico no tiene un formato válido."));
  if (rawPhone && !phone) redirect(customerUrl("error", "El teléfono debe contener entre 8 y 15 dígitos."));
  if (marketingConsent && !email && !phone) redirect(customerUrl("error", "Para autorizar comunicaciones comerciales debe existir al menos un correo o teléfono de contacto."));

  if (rut.value && rut.value !== current.rut) {
    const duplicate = await prisma.customer.findUnique({ where: { rut: rut.value }, select: { id: true } });
    if (duplicate && duplicate.id !== id) redirect(customerUrl("error", `Ya existe un cliente con el RUT ${rut.value}.`));
  }

  const consentChanged = marketingConsent !== current.marketingConsent;
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          name,
          rut: rut.value,
          email,
          phone,
          address,
          active,
          marketingConsent,
          marketingConsentAt: marketingConsent ? (current.marketingConsentAt ?? now) : null,
          marketingConsentSource: consentChanged ? "ADMIN_CUSTOMER_REGISTRY" : current.marketingConsentSource,
        },
      });

      if (consentChanged) {
        await tx.customerConsentEvent.create({
          data: {
            customerId: id,
            kind: CustomerConsentKind.MARKETING,
            granted: marketingConsent,
            noticeVersion: current.privacyNoticeVersion,
            source: "ADMIN_CUSTOMER_REGISTRY",
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isUniqueConstraintError(error)) redirect(customerUrl("error", "Ya existe un cliente con uno de los identificadores únicos ingresados."));
    throw error;
  }

  refreshCustomers();
  redirect(customerUrl("ok", `Cliente ${name} actualizado.`));
}

export async function anonymizeCustomer(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const confirm = text(formData, "confirm", 20).toUpperCase();
  const current = await prisma.customer.findUnique({ where: { id }, select: { id: true, name: true, anonymizedAt: true, privacyNoticeVersion: true } });
  if (!current) redirect(customerUrl("error", "Cliente no encontrado."));
  if (current.anonymizedAt) redirect(customerUrl("error", "El cliente ya está anonimizado."));
  if (confirm !== "ANONIMIZAR") redirect(customerUrl("error", "Escribe ANONIMIZAR para confirmar la anonimización del perfil."));

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id },
      data: {
        name: `Cliente anonimizado ${id.slice(-6).toUpperCase()}`,
        rut: null,
        email: null,
        phone: null,
        address: null,
        active: false,
        marketingConsent: false,
        marketingConsentAt: null,
        marketingConsentSource: "ANONYMIZATION",
        anonymizedAt: now,
      },
    });
    await tx.customerConsentEvent.create({
      data: {
        customerId: id,
        kind: CustomerConsentKind.MARKETING,
        granted: false,
        noticeVersion: current.privacyNoticeVersion,
        source: "ANONYMIZATION",
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  refreshCustomers();
  redirect(customerUrl("ok", `Perfil de ${current.name} anonimizado. Las ventas históricas conservan su snapshot transaccional.`));
}
