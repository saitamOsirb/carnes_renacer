import { roundQuantity } from "@/lib/quantity";

export type ScaleBarcodeMode = "WEIGHT" | "PRICE";

export type ScaleBarcodeConfig = {
  weightPrefixes: string[];
  pricePrefixes: string[];
  priceDivisor: number;
};

export type ParsedScaleBarcode = {
  barcode: string;
  prefix: string;
  plu: string;
  payload: string;
  mode: ScaleBarcodeMode;
  quantityKg: number | null;
  amountClp: number | null;
};

export const SCALE_PLU_PREFIX = "scale-plu:";
export const SCALE_WEIGHT_PREFIXES_KEY = "scale:ean13:weight-prefixes";
export const SCALE_PRICE_PREFIXES_KEY = "scale:ean13:price-prefixes";
export const SCALE_PRICE_DIVISOR_KEY = "scale:ean13:price-divisor";
export const ALLOWED_SCALE_PRICE_DIVISORS = [1, 10, 100, 1000] as const;

export const DEFAULT_SCALE_BARCODE_CONFIG: ScaleBarcodeConfig = {
  weightPrefixes: ["20"],
  pricePrefixes: [],
  priceDivisor: 1,
};

export function parseScalePrefixes(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (tokens.some((token) => !/^2[0-9]$/.test(token))) return null;
  return [...new Set(tokens)];
}

export function normalizeScalePriceDivisor(value: string | number | null | undefined): number {
  const divisor = Number(value);
  return ALLOWED_SCALE_PRICE_DIVISORS.includes(divisor as (typeof ALLOWED_SCALE_PRICE_DIVISORS)[number])
    ? divisor
    : DEFAULT_SCALE_BARCODE_CONFIG.priceDivisor;
}

export function buildScaleBarcodeConfig(values?: {
  weightPrefixes?: string | null;
  pricePrefixes?: string | null;
  priceDivisor?: string | number | null;
}): ScaleBarcodeConfig {
  const weight = values?.weightPrefixes === null || values?.weightPrefixes === undefined
    ? DEFAULT_SCALE_BARCODE_CONFIG.weightPrefixes
    : parseScalePrefixes(values.weightPrefixes);
  const price = values?.pricePrefixes === null || values?.pricePrefixes === undefined
    ? DEFAULT_SCALE_BARCODE_CONFIG.pricePrefixes
    : parseScalePrefixes(values.pricePrefixes);

  return {
    weightPrefixes: weight ?? DEFAULT_SCALE_BARCODE_CONFIG.weightPrefixes,
    pricePrefixes: price ?? DEFAULT_SCALE_BARCODE_CONFIG.pricePrefixes,
    priceDivisor: normalizeScalePriceDivisor(values?.priceDivisor),
  };
}

export function calculateEan13CheckDigit(body12: string): number | null {
  if (!/^\d{12}$/.test(body12)) return null;
  const sum = [...body12].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const expected = calculateEan13CheckDigit(value.slice(0, 12));
  return expected !== null && expected === Number(value[12]);
}

export function parseScaleEan13(barcode: string, config: ScaleBarcodeConfig): ParsedScaleBarcode | null {
  const normalized = barcode.replace(/\s+/g, "").trim();
  if (!isValidEan13(normalized)) return null;

  const prefix = normalized.slice(0, 2);
  const inWeight = config.weightPrefixes.includes(prefix);
  const inPrice = config.pricePrefixes.includes(prefix);
  if (!inWeight && !inPrice) return null;
  if (inWeight && inPrice) return null;

  const plu = normalized.slice(2, 7);
  const payload = normalized.slice(7, 12);
  const numericPayload = Number(payload);
  if (!Number.isInteger(numericPayload) || numericPayload <= 0) return null;

  if (inWeight) {
    const quantityKg = roundQuantity(numericPayload / 1000);
    if (quantityKg <= 0) return null;
    return {
      barcode: normalized,
      prefix,
      plu,
      payload,
      mode: "WEIGHT",
      quantityKg,
      amountClp: null,
    };
  }

  const amountClp = numericPayload / config.priceDivisor;
  if (!Number.isFinite(amountClp) || amountClp <= 0) return null;
  return {
    barcode: normalized,
    prefix,
    plu,
    payload,
    mode: "PRICE",
    quantityKg: null,
    amountClp,
  };
}
