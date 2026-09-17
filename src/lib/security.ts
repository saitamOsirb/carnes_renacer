import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "El contenido debe enviarse como JSON.", "UNSUPPORTED_MEDIA_TYPE");
  }
}

export function assertTrustedOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!origin || !appUrl || origin !== appUrl) {
    throw new HttpError(403, "Origen de solicitud no autorizado.", "INVALID_ORIGIN");
  }
}

export function assertCsrf(request: Request): void {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("renacer_csrf="))
    ?.split("=")[1];
  const header = request.headers.get("x-csrf-token");

  if (!cookie || !header) {
    throw new HttpError(403, "Token CSRF ausente.", "CSRF_MISSING");
  }

  const cookieBuffer = Buffer.from(cookie);
  const headerBuffer = Buffer.from(header);
  if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
    throw new HttpError(403, "Token CSRF inválido.", "CSRF_INVALID");
  }
}

export function getClientIp(request: Request | NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function hashIdentifier(value: string): string {
  const secret = process.env.CSRF_SECRET ?? "local-only-not-for-production";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const existing = await prisma.rateLimitBucket.findUnique({ where: { key } });

  if (!existing || existing.windowStart < windowStart) {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, windowStart: now },
      update: { count: 1, windowStart: now },
    });
    return;
  }

  if (existing.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.windowStart.getTime() + windowMs - now.getTime()) / 1000));
    throw new HttpError(429, "Demasiadas solicitudes. Intenta nuevamente más tarde.", "RATE_LIMITED", retryAfter);
  }

  await prisma.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { ok: false, code: error.code, message: error.message },
      {
        status: error.status,
        headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined,
      },
    );
  }

  console.error(error);
  return Response.json(
    { ok: false, code: "INTERNAL_ERROR", message: "No pudimos procesar la solicitud." },
    { status: 500 },
  );
}
