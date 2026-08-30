import { describe, it, expect } from "vitest";
import { computeInvoiceTotals } from "./invoiceMath";

// Invoice math is one of the two places a bug is expensive (the other being
// gapless numbering), so it gets real tests. Prices are VAT-INCLUSIVE (gross).

describe("computeInvoiceTotals (VAT-inclusive prices)", () => {
  it("splits a single 21% line into net + VAT that sum back to gross", () => {
    const t = computeInvoiceTotals([
      { unitPrice: "12.00", quantity: 2, vatRate: 21 },
    ]);
    // 24.00 gross → base 24/1.21 = 19.83, vat = 4.17
    expect(t.total).toBe("24.00");
    expect(t.subtotal).toBe("19.83");
    expect(t.vatAmount).toBe("4.17");
    expect(t.lineTotals).toEqual(["24.00"]);
    // The core invariant: net + VAT == gross, exactly.
    expect(Number(t.subtotal) + Number(t.vatAmount)).toBeCloseTo(
      Number(t.total),
      2,
    );
  });

  it("groups VAT per rate and keeps the invariant across mixed rates", () => {
    const t = computeInvoiceTotals([
      { unitPrice: "12.00", quantity: 1, vatRate: 21 }, // 21% bucket
      { unitPrice: "10.00", quantity: 1, vatRate: 6 }, // 6% bucket
    ]);
    expect(t.total).toBe("22.00");
    expect(t.vatByRate).toHaveLength(2);
    // Buckets are ordered ascending by rate.
    expect(t.vatByRate[0].vatRate).toBe("6.00");
    expect(t.vatByRate[1].vatRate).toBe("21.00");
    expect(Number(t.subtotal) + Number(t.vatAmount)).toBeCloseTo(22.0, 2);
    // 6%: base 10/1.06 = 9.43, vat 0.57 ; 21%: base 9.92, vat 2.08
    expect(t.vatByRate[0].vat).toBe("0.57");
    expect(t.vatByRate[1].vat).toBe("2.08");
  });

  it("multiplies unit price by quantity for line totals", () => {
    const t = computeInvoiceTotals([
      { unitPrice: "14.00", quantity: 3, vatRate: 21 },
    ]);
    expect(t.lineTotals).toEqual(["42.00"]);
    expect(t.total).toBe("42.00");
  });

  it("handles an empty invoice", () => {
    const t = computeInvoiceTotals([]);
    expect(t).toMatchObject({
      subtotal: "0.00",
      vatAmount: "0.00",
      total: "0.00",
      lineTotals: [],
      vatByRate: [],
    });
  });
});
