import { z } from "zod";
import { roundQuantity } from "@/lib/quantity";
import { validateRut } from "@/lib/rut";

export const checkoutItemSchema = z.object({
  productId: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  quantity: z.number().positive().max(100_000).refine(
    (value) => Math.abs(value - roundQuantity(value)) < 1e-9,
    "La cantidad admite como máximo tres decimales.",
  ),
});

export const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1).max(30),
  couponCode: z.string().trim().toUpperCase().max(30).optional().or(z.literal("")),
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    phone: z.string().trim().regex(/^\+?[0-9\s-]{8,18}$/),
    rut: z
      .string()
      .trim()
      .max(20)
      .optional()
      .or(z.literal(""))
      .refine((value) => !value || validateRut(value), "RUT inválido"),
    addressLine: z.string().trim().min(5).max(180),
    addressDetail: z.string().trim().max(100).optional().or(z.literal("")),
    commune: z.enum(["Antofagasta"]),
    region: z.literal("Región de Antofagasta"),
    deliveryDate: z.string().date().optional().or(z.literal("")),
    notes: z.string().trim().max(250).optional().or(z.literal("")),
    termsAccepted: z.literal(true),
  }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
