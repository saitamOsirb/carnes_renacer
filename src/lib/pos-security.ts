import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PIN_PATTERN = /^\d{4,12}$/;

export function validatePosPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function hashPosPin(pin: string): string {
  if (!validatePosPin(pin)) throw new Error("El PIN debe tener entre 4 y 12 dígitos.");
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPosPin(pin: string, encoded: string): boolean {
  if (!validatePosPin(pin)) return false;
  const [algorithm, saltHex, hashHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pin, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
