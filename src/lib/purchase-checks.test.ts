import { describe, it, expect } from "vitest";
import {
  checkPurchaseInvoice,
  countryFromVatNumber,
  findDuplicates,
  todayInBrussels,
  vatNumberMatchesCountry,
  type PurchaseCheckInput,
} from "./purchase-checks";
import { parseAmount, toCents } from "./purchases";

// The sanity checks only ever FLAG — but a wrong flag (or a missed one) erodes
// trust in the review screen, so they get real tests.

const TODAY = "2026-10-24";

const clean: PurchaseCheckInput = {
  supplierName: "Holzhandel GmbH",
  supplierCountry: "DE",
  supplierVatNumber: "DE123456789",
  invoiceNumber: "RE-2026-0042",
  invoiceDate: "2026-10-20",
  currency: "EUR",
  netAmount: "100.00",
  vatAmount: null,
  grossAmount: "100.00",
  vatTreatment: "EU_REVERSE_CHARGE",
};

const codes = (input: PurchaseCheckInput, duplicates: { id: string }[] = []) =>
  checkPurchaseInvoice(input, { today: TODAY, duplicates }).map((f) => f.code);

describe("parseAmount", () => {
  it("reads Belgian, English and plain notations", () => {
    expect(parseAmount("1.234,56")).toBe("1234.56");
    expect(parseAmount("1,234.56")).toBe("1234.56");
    expect(parseAmount("12,5")).toBe("12.50");
    expect(parseAmount("€ 99")).toBe("99.00");
    expect(parseAmount("1 250,00 €")).toBe("1250.00");
    expect(parseAmount("-3,10")).toBe("-3.10");
  });

  it("rounds half-up to cents and rejects non-numbers", () => {
    expect(parseAmount("2.345")).toBe("2.35");
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(toCents("1.234,56")).toBe(123456);
  });
});

describe("checkPurchaseInvoice", () => {
  it("a clean EU reverse-charge invoice raises nothing", () => {
    expect(codes(clean)).toEqual([]);
  });

  it("flags net + VAT ≠ gross, and accepts it when it adds up", () => {
    expect(codes({ ...clean, netAmount: "100.00", grossAmount: "121.00" })).toContain(
      "TOTAL_MISMATCH",
    );
    expect(
      codes({
        ...clean,
        supplierCountry: "BE",
        supplierVatNumber: "BE0123456789",
        vatTreatment: "BELGIAN_VAT",
        netAmount: "100,00",
        vatAmount: "21,00",
        grossAmount: "121,00",
      }),
    ).toEqual([]);
  });

  it("flags a VAT number that doesn't fit the country", () => {
    expect(codes({ ...clean, supplierVatNumber: "NL123456789B01" })).toContain(
      "VAT_NUMBER_COUNTRY",
    );
    expect(codes({ ...clean, supplierVatNumber: "DE12345" })).toContain("VAT_NUMBER_FORMAT");
    // Greece uses EL, not GR.
    expect(
      codes({ ...clean, supplierCountry: "GR", supplierVatNumber: "EL123456789" }),
    ).not.toContain("VAT_NUMBER_COUNTRY");
  });

  it("never flags a VAT number for a country it has no rule for", () => {
    expect(
      codes({
        ...clean,
        supplierCountry: "US",
        supplierVatNumber: "whatever",
        vatTreatment: "NON_EU_IMPORT",
      }),
    ).toEqual([]);
  });

  it("flags duplicates passed in by the caller", () => {
    expect(codes(clean, [{ id: "x" }])).toContain("DUPLICATE");
  });

  it("flags dates far in the past or in the future, not recent ones", () => {
    expect(codes({ ...clean, invoiceDate: "2026-01-01" })).toContain("DATE_FAR_PAST");
    expect(codes({ ...clean, invoiceDate: "2026-12-01" })).toContain("DATE_FUTURE");
    expect(codes({ ...clean, invoiceDate: "2026-10-28" })).toEqual([]); // within 7 days
    expect(codes({ ...clean, invoiceDate: "2026-05-01" })).toEqual([]); // < 180 days
  });

  it("flags an EU supplier outside Belgium that charged VAT", () => {
    expect(
      codes({ ...clean, netAmount: "100.00", vatAmount: "19.00", grossAmount: "119.00" }),
    ).toContain("EU_VAT_CHARGED");
  });

  it("flags a VAT treatment that doesn't match the supplier's country", () => {
    expect(
      codes({ ...clean, supplierCountry: "BE", supplierVatNumber: "BE0123456789" }),
    ).toContain("TREATMENT_COUNTRY");
    expect(codes({ ...clean, vatTreatment: "NON_EU_IMPORT" })).toContain("TREATMENT_COUNTRY");
  });

  it("flags a foreign-currency invoice without an EUR amount", () => {
    expect(
      codes({ ...clean, supplierCountry: "SE", supplierVatNumber: "SE123456789012", currency: "SEK" }),
    ).toContain("MISSING_EUR");
    expect(
      codes({
        ...clean,
        supplierCountry: "SE",
        supplierVatNumber: "SE123456789012",
        currency: "SEK",
        amountEur: "8,90",
      }),
    ).toEqual([]);
  });
});

describe("VAT number helpers", () => {
  it("maps prefixes to countries (EL → GR)", () => {
    expect(countryFromVatNumber("de 123 456 789")).toBe("DE");
    expect(countryFromVatNumber("EL123456789")).toBe("GR");
    expect(countryFromVatNumber("US12345")).toBeNull();
  });

  it("validates per-country formats", () => {
    expect(vatNumberMatchesCountry("ATU12345678", "AT")).toEqual({ ok: true });
    expect(vatNumberMatchesCountry("NL123456789B01", "NL")).toEqual({ ok: true });
    expect(vatNumberMatchesCountry("FR12345678901", "FR")).toEqual({ ok: true });
    expect(vatNumberMatchesCountry("BE 0123.456.789", "BE")).toEqual({ ok: true });
    expect(vatNumberMatchesCountry("BE2123456789", "BE")).toEqual({ ok: false, reason: "format" });
  });
});

describe("findDuplicates", () => {
  const others = [
    { id: "a", supplierId: "s1", supplierName: "Acme", invoiceNumber: "INV-001" },
    { id: "b", supplierId: "s2", supplierName: "Other", invoiceNumber: "INV-001" },
    { id: "c", supplierId: null, supplierName: "acme ", invoiceNumber: "inv 001" },
  ];

  it("matches the same supplier and number, ignoring case and separators", () => {
    const d = findDuplicates(
      { id: "new", supplierId: "s1", supplierName: "Acme", invoiceNumber: "inv001" },
      others,
    );
    // a: same supplierId; c: no supplierId, so compared by name.
    expect(d.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("ignores itself and invoices without a number", () => {
    expect(findDuplicates({ ...others[0] }, others).map((x) => x.id)).toEqual(["c"]);
    expect(
      findDuplicates({ id: "n", supplierId: "s1", supplierName: "Acme", invoiceNumber: null }, others),
    ).toEqual([]);
  });
});

describe("todayInBrussels", () => {
  it("uses the Brussels calendar day, not UTC", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Brussels (UTC+1).
    expect(todayInBrussels(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
