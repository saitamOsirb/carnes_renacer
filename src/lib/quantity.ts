export type QuantityUnit = "KG" | "UNIT";
export type QuantityValue = number | string | { toString(): string };

export const QUANTITY_DECIMALS = 3;
export const QUANTITY_FACTOR = 10 ** QUANTITY_DECIMALS;
export const MIN_WEIGHT_KG = 0.001;
export const DEFAULT_WEIGHT_STEP_KG = 0.001;
export const DEFAULT_UNIT_STEP = 1;
export const MAX_LINE_QUANTITY = 100_000;

export function toQuantityNumber(value: QuantityValue | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numeric) ? numeric : 0;
}

export function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * QUANTITY_FACTOR) / QUANTITY_FACTOR;
}

export function quantityStep(unit: QuantityUnit): number {
  return unit === "KG" ? DEFAULT_WEIGHT_STEP_KG : DEFAULT_UNIT_STEP;
}

export function isValidQuantityForUnit(value: number, unit: QuantityUnit, options?: { allowZero?: boolean; max?: number }): boolean {
  if (!Number.isFinite(value)) return false;
  const rounded = roundQuantity(value);
  const minimum = options?.allowZero ? 0 : unit === "KG" ? MIN_WEIGHT_KG : 1;
  const maximum = options?.max ?? MAX_LINE_QUANTITY;
  if (rounded < minimum || rounded > maximum) return false;
  if (Math.abs(value - rounded) > 1e-9) return false;
  if (unit === "UNIT" && !Number.isInteger(rounded)) return false;
  return true;
}

export function normalizeQuantity(value: number, unit: QuantityUnit, max = MAX_LINE_QUANTITY): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = roundQuantity(value);
  if (rounded <= 0) return 0;
  const capped = Math.min(rounded, roundQuantity(max));
  if (unit === "UNIT") return Math.max(0, Math.floor(capped));
  return capped < MIN_WEIGHT_KG ? 0 : capped;
}

export function formatQuantity(value: QuantityValue, unit: QuantityUnit, includeUnit = true): string {
  const quantity = roundQuantity(toQuantityNumber(value));
  const text = new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === "KG" ? QUANTITY_DECIMALS : 0,
  }).format(quantity);
  if (!includeUnit) return text;
  return `${text} ${unit === "KG" ? "kg" : quantity === 1 ? "un." : "un."}`;
}

export function calculateQuantitySubtotal(unitPrice: number, quantity: number): number {
  if (!Number.isInteger(unitPrice) || unitPrice < 0 || !Number.isFinite(quantity)) return 0;
  return Math.round(unitPrice * roundQuantity(quantity));
}
