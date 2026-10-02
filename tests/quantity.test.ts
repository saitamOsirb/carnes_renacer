import { describe, expect, it } from "vitest";
import {
  calculateQuantitySubtotal,
  formatQuantity,
  isValidQuantityForUnit,
  normalizeQuantity,
  roundQuantity,
} from "@/lib/quantity";

describe("cantidades comerciales", () => {
  it("acepta kilos con precisión de un gramo", () => {
    expect(isValidQuantityForUnit(0.742, "KG")).toBe(true);
    expect(isValidQuantityForUnit(1.285, "KG")).toBe(true);
    expect(isValidQuantityForUnit(0.0005, "KG")).toBe(false);
  });

  it("mantiene productos por unidad en enteros", () => {
    expect(isValidQuantityForUnit(2, "UNIT")).toBe(true);
    expect(isValidQuantityForUnit(2.5, "UNIT")).toBe(false);
    expect(normalizeQuantity(2.9, "UNIT")).toBe(2);
  });

  it("redondea cantidades a tres decimales", () => {
    expect(roundQuantity(1.2344)).toBe(1.234);
    expect(roundQuantity(1.2346)).toBe(1.235);
  });

  it("redondea el subtotal final a pesos chilenos", () => {
    expect(calculateQuantitySubtotal(12990, 0.742)).toBe(9639);
  });

  it("formatea kilos con hasta tres decimales", () => {
    expect(formatQuantity(0.742, "KG")).toBe("0,742 kg");
    expect(formatQuantity(2, "UNIT")).toBe("2 un.");
  });
});
