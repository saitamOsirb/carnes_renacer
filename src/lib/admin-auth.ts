import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_COOKIE = "renacer_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function getAdminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value || value.length < 10) {
    throw new Error("ADMIN_PASSWORD debe configurarse con al menos 10 caracteres.");
  }
  return value;
}

function getSessionSecret(): string {
  const value = process.env.ADMIN_SESSION_SECRET ?? process.env.CSRF_SECRET;
  if (!value || value.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET debe configurarse con al menos 32 caracteres.");
  }
  return value;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function sign(expiresAt: number): string {
  return createHmac("sha256", getSessionSecret())
    .update(`renacer-admin:${expiresAt}`)
    .digest("hex");
}

export async function createAdminSession(password: string): Promise<boolean> {
  if (!safeEqual(password, getAdminPassword())) return false;

  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = `${expiresAt}.${sign(expiresAt)}`;
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    expires: new Date(expiresAt),
  });
  return true;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return false;

  const [expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) return false;

  return safeEqual(signature, sign(expiresAt));
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}
