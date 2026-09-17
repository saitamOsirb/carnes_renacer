import { z } from "zod";

const serverEnvSchema = z.object({
  APP_URL: z.string().url().transform((value) => value.replace(/\/$/, "")),
  DATABASE_URL: z.string().min(1),
  WEBPAY_ENV: z.enum(["integration", "production"]),
  WEBPAY_COMMERCE_CODE: z.string().min(1),
  WEBPAY_API_KEY_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().optional(),
  ORDER_FROM_EMAIL: z.string().email().optional(),
  ORDER_NOTIFICATION_EMAIL: z.string().email().optional(),
  CSRF_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }
  cached = parsed.data;
  return cached;
}
