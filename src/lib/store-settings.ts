import "server-only";

import { prisma } from "@/lib/prisma";

export const CHECKOUT_WHATSAPP_KEY = "checkout_whatsapp";
export const DEFAULT_CHECKOUT_WHATSAPP = "56991851942";

export function normalizeWhatsappNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

export async function getCheckoutWhatsappNumber(): Promise<string> {
  const setting = await prisma.storeSetting.findUnique({
    where: { key: CHECKOUT_WHATSAPP_KEY },
    select: { value: true },
  });
  return normalizeWhatsappNumber(setting?.value ?? "") || DEFAULT_CHECKOUT_WHATSAPP;
}

export async function setCheckoutWhatsappNumber(value: string): Promise<string> {
  const normalized = normalizeWhatsappNumber(value);
  if (!normalized) throw new Error("Número de WhatsApp inválido.");

  await prisma.storeSetting.upsert({
    where: { key: CHECKOUT_WHATSAPP_KEY },
    create: { key: CHECKOUT_WHATSAPP_KEY, value: normalized },
    update: { value: normalized },
  });
  return normalized;
}
