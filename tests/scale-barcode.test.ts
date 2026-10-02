import { describe, expect, it } from "vitest";
import {
  buildScaleBarcodeConfig,
  calculateEan13CheckDigit,
  isValidEan13,
  parseScaleEan13,
  parseScalePrefixes,
} from "@/lib/scale-barcode";

function makeEan13(prefix: string, plu: string, payload: string): string {
  const body = `${prefix}${plu}${payload}`;
  const checkDigit = calculateEan13CheckDigit(body);
  if (checkDigit === null) throw new Error("EAN-13 de prueba inválido");
  return `${body}${checkDigit}`;
}

describe("códigos EAN-13 de balanza", () => {
  it("extrae PLU y peso en gramos como kilogramos", () => {
    const code = makeEan13("20", "01234", "00742");
    const parsed = parseScaleEan13(code, buildScaleBarcodeConfig({ weightPrefixes: "20", pricePrefixes: "" }));

    expect(isValidEan13(code)).toBe(true);
    expect(parsed).toMatchObject({
      prefix: "20",
      plu: "01234",
      payload: "00742",
      mode: "WEIGHT",
      quantityKg: 0.742,
      amountClp: null,
    });
  });

  it("extrae importe cuando el prefijo está configurado como precio", () => {
    const code = makeEan13("21", "54321", "15575");
    const parsed = parseScaleEan13(code, buildScaleBarcodeConfig({ weightPrefixes: "", pricePrefixes: "21", priceDivisor: 1 }));

    expect(parsed).toMatchObject({
      prefix: "21",
      plu: "54321",
      mode: "PRICE",
      quantityKg: null,
      amountClp: 15575,
    });
  });

  it("permite balanzas que codifican centavos mediante divisor", () => {
    const code = makeEan13("22", "00007", "12345");
    const parsed = parseScaleEan13(code, buildScaleBarcodeConfig({ weightPrefixes: "", pricePrefixes: "22", priceDivisor: 100 }));

    expect(parsed?.amountClp).toBe(123.45);
  });

  it("rechaza checksum EAN-13 incorrecto", () => {
    const valid = makeEan13("20", "01234", "00742");
    const invalid = `${valid.slice(0, 12)}${valid[12] === "9" ? "0" : Number(valid[12]) + 1}`;

    expect(isValidEan13(invalid)).toBe(false);
    expect(parseScaleEan13(invalid, buildScaleBarcodeConfig())).toBeNull();
  });

  it("solo acepta prefijos internos EAN-13 20 a 29", () => {
    expect(parseScalePrefixes("20, 21;29")).toEqual(["20", "21", "29"]);
    expect(parseScalePrefixes("")).toEqual([]);
    expect(parseScalePrefixes("19,20")).toBeNull();
    expect(parseScalePrefixes("ABC")).toBeNull();
  });

  it("no interpreta un prefijo configurado a la vez como peso y precio", () => {
    const code = makeEan13("20", "01234", "00742");
    expect(parseScaleEan13(code, buildScaleBarcodeConfig({ weightPrefixes: "20", pricePrefixes: "20" }))).toBeNull();
  });
});
