import { describe, expect, it } from "vitest";
import { offerSaveSchema } from "./validation";

// The offer editor posts what you typed: Belgian decimals, empty fields, etc.

const line = (p: Record<string, unknown> = {}) => ({
  description: "Naambord",
  quantity: "2",
  price: "12,50",
  vatRate: "21",
  costing: null,
  ...p,
});

describe("offerSaveSchema", () => {
  it("accepts comma decimals and empty costing fields", () => {
    const r = offerSaveSchema.parse({
      pricesIncludeVat: true,
      validUntil: "2026-10-27",
      intro: "",
      terms: "  ",
      lines: [
        line({
          costing: {
            machineId: "",
            machineMinutes: "12,5",
            labourHours: "",
            setupHours: null,
            materials: [{ materialId: "m1", quantity: "0,25" }],
          },
        }),
      ],
    });
    expect(r.lines[0].price).toBe("12.50");
    expect(r.lines[0].quantity).toBe(2);
    expect(r.lines[0].costing).toEqual({
      machineId: null,
      machineMinutes: 12.5,
      labourHours: 0,
      setupHours: 0,
      materials: [{ materialId: "m1", quantity: 0.25 }],
    });
    expect(r.intro).toBeNull();
    expect(r.terms).toBeNull();
  });

  it("allows a negative discount line but rejects garbage", () => {
    expect(
      offerSaveSchema.safeParse({ pricesIncludeVat: true, lines: [line({ price: "-5" })] }).success,
    ).toBe(true);
    expect(
      offerSaveSchema.safeParse({ pricesIncludeVat: true, lines: [line({ price: "abc" })] }).success,
    ).toBe(false);
    expect(
      offerSaveSchema.safeParse({
        pricesIncludeVat: true,
        lines: [line({ costing: { machineMinutes: "-3", materials: [] } })],
      }).success,
    ).toBe(false);
    expect(offerSaveSchema.safeParse({ pricesIncludeVat: true, lines: [] }).success).toBe(false);
  });
});
