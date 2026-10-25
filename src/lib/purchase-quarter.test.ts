import { describe, it, expect } from "vitest";
import {
  eurCents,
  previousQuarter,
  quarterDeadline,
  quarterOf,
  quarterRange,
  summarizeByTreatment,
  type QuarterInvoice,
} from "./purchase-quarter";

// Quarter boundaries decide which invoices you cross-check against a VAT
// return, so an off-by-one here is expensive. Tested on the edges.

describe("quarterOf", () => {
  it("puts the first and last day of each quarter in the right quarter", () => {
    expect(quarterOf("2026-01-01")).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf("2026-03-31")).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf("2026-04-01")).toEqual({ year: 2026, quarter: 2 });
    expect(quarterOf("2026-06-30")).toEqual({ year: 2026, quarter: 2 });
    expect(quarterOf("2026-07-01")).toEqual({ year: 2026, quarter: 3 });
    expect(quarterOf("2026-09-30")).toEqual({ year: 2026, quarter: 3 });
    expect(quarterOf("2026-10-01")).toEqual({ year: 2026, quarter: 4 });
    expect(quarterOf("2026-12-31")).toEqual({ year: 2026, quarter: 4 });
  });
});

describe("quarterRange", () => {
  it("returns an inclusive start and an exclusive end", () => {
    expect(quarterRange(2026, 1)).toEqual({
      start: "2026-01-01",
      endExclusive: "2026-04-01",
      lastDay: "2026-03-31",
    });
    expect(quarterRange(2026, 2).lastDay).toBe("2026-06-30");
    expect(quarterRange(2026, 3).lastDay).toBe("2026-09-30");
  });

  it("rolls Q4 over into the next year", () => {
    expect(quarterRange(2026, 4)).toEqual({
      start: "2026-10-01",
      endExclusive: "2027-01-01",
      lastDay: "2026-12-31",
    });
  });
});

describe("quarterDeadline", () => {
  it("is the configured day of the month after the quarter", () => {
    expect(quarterDeadline(2026, 1)).toBe("2026-04-25");
    expect(quarterDeadline(2026, 3)).toBe("2026-10-25");
  });

  it("rolls Q4 into January of the next year", () => {
    expect(quarterDeadline(2026, 4)).toBe("2027-01-25");
  });

  it("follows a changed rule and clamps to the month's length", () => {
    expect(quarterDeadline(2026, 4, { monthsAfterQuarterEnd: 2, dayOfMonth: 31 })).toBe(
      "2027-02-28",
    );
  });
});

describe("previousQuarter", () => {
  it("steps back across the year boundary", () => {
    expect(previousQuarter(2027, 1)).toEqual({ year: 2026, quarter: 4 });
    expect(previousQuarter(2026, 3)).toEqual({ year: 2026, quarter: 2 });
  });
});

const inv = (over: Partial<QuarterInvoice>): QuarterInvoice => ({
  status: "CHECKED",
  vatTreatment: "EU_REVERSE_CHARGE",
  currency: "EUR",
  netAmount: "100.00",
  vatAmount: null,
  grossAmount: "100.00",
  amountEur: null,
  ...over,
});

describe("eurCents", () => {
  it("passes EUR amounts through", () => {
    expect(eurCents(inv({ netAmount: "100.00", vatAmount: "21.00", grossAmount: "121.00" }))).toEqual({
      net: 10000,
      vat: 2100,
      gross: 12100,
      converted: false,
    });
  });

  it("spreads a foreign invoice's EUR amount over net and VAT proportionally", () => {
    const r = eurCents(
      inv({ currency: "USD", netAmount: "100.00", vatAmount: "20.00", grossAmount: "120.00", amountEur: "110.00" }),
    );
    expect(r).toEqual({ net: 9167, vat: 1833, gross: 11000, converted: true });
  });

  it("returns null for a foreign invoice without an EUR amount", () => {
    expect(eurCents(inv({ currency: "USD" }))).toBeNull();
  });
});

describe("summarizeByTreatment", () => {
  it("totals per treatment in enum order, counting what's not in Dexxter yet", () => {
    const { rows, total } = summarizeByTreatment([
      inv({ vatTreatment: "BELGIAN_VAT", netAmount: "50.00", vatAmount: "10.50", grossAmount: "60.50" }),
      inv({ status: "UPLOADED_TO_DEXXTER" }),
      inv({ status: "RECEIVED", netAmount: "20.00", grossAmount: "20.00" }),
      inv({ currency: "GBP", amountEur: null }),
    ]);
    expect(rows.map((r) => r.treatment)).toEqual(["EU_REVERSE_CHARGE", "BELGIAN_VAT"]);
    const eu = rows[0];
    expect(eu.count).toBe(3);
    expect(eu.gross).toBe("120.00"); // the GBP one is left out…
    expect(eu.missingEurCount).toBe(1); // …and reported
    expect(eu.notUploadedCount).toBe(2);
    expect(rows[1].vat).toBe("10.50");
    expect(total.count).toBe(4);
    expect(total.gross).toBe("180.50");
    expect(total.notUploadedCount).toBe(3);
  });
});
