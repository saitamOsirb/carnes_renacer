import { describe, expect, it } from "vitest";
import { formatRut, normalizeRut, validateRut } from "@/lib/rut";

describe("RUT chileno", () => {
  it("normaliza puntos y guion", () => {
    expect(normalizeRut("12.345.678-5")).toBe("123456785");
  });

  it("valida dígitos verificadores", () => {
    expect(validateRut("12.345.678-5")).toBe(true);
    expect(validateRut("12.345.678-9")).toBe(false);
  });

  it("formatea un RUT normalizado", () => {
    expect(formatRut("123456785")).toBe("12.345.678-5");
  });
});
