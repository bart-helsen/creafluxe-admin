import { describe, it, expect } from "vitest";
import { findDate, findVatNumbers, parseInvoiceText } from "./parseInvoiceText";

// The prefill is best-effort, but it must never invent a value from noise —
// these cover the common layouts of EU supplier invoices.

describe("findDate", () => {
  it("reads the usual European formats", () => {
    expect(findDate("Datum: 14.03.2026")).toBe("2026-03-14");
    expect(findDate("14/03/2026")).toBe("2026-03-14");
    expect(findDate("2026-03-14")).toBe("2026-03-14");
    expect(findDate("14. März 2026")).toBe("2026-03-14");
    expect(findDate("14 maart 2026")).toBe("2026-03-14");
    expect(findDate("March 14, 2026")).toBe("2026-03-14");
  });

  it("rejects impossible dates", () => {
    expect(findDate("31.02.2026")).toBeUndefined();
  });
});

describe("findVatNumbers", () => {
  it("finds well-formed numbers, even glued to the next word", () => {
    expect(findVatNumbers("USt-IdNr.: DE 123 456 789 RECHNUNG")).toEqual(["DE123456789"]);
    expect(findVatNumbers("ATTENTION DE123456789")).toEqual(["DE123456789"]);
    expect(findVatNumbers("BTW NL123456789B01 EN BE 0123.456.789")).toEqual([
      "NL123456789B01",
      "BE0123456789",
    ]);
  });

  it("ignores words that merely start with a country code", () => {
    expect(findVatNumbers("DETAILS ITEM FREIGHT")).toEqual([]);
  });
});

const GERMAN = `
Holzhandel Müller GmbH · Hauptstraße 1 · 10115 Berlin
USt-IdNr. DE123456789
Rechnung
Rechnungsnummer: RE-2026-0042
Rechnungsdatum: 14.03.2026
Kunde: Creafluxe, BE 0123.456.789
Pos Artikel Menge Preis
1 Birke Sperrholz 3mm 10 12,35 € 123,50 €
Nettobetrag 123,50 €
Gesamtbetrag 123,50 €
Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)
`;

describe("parseInvoiceText", () => {
  it("prefills a German reverse-charge invoice and skips our own VAT number", () => {
    const r = parseInvoiceText(GERMAN, { ownVatNumbers: ["BE0123456789"] });
    expect(r.invoiceNumber).toBe("RE-2026-0042");
    expect(r.invoiceDate).toBe("2026-03-14");
    expect(r.currency).toBe("EUR");
    expect(r.netAmount).toBe("123.50");
    expect(r.vatAmount).toBeUndefined();
    expect(r.grossAmount).toBe("123.50");
    expect(r.supplierVatNumber).toBe("DE123456789");
    expect(r.supplierCountry).toBe("DE");
    expect(r.reverseCharge).toBe(true);
    expect(r.confidence).toBe(100);
  });

  it("matches net + VAT = gross when VAT was charged", () => {
    const r = parseInvoiceText(`
      Invoice number
      INV-88123
      Invoice date: March 2, 2026
      Subtotal €1,000.00
      VAT 21% €210.00
      Total due €1,210.00
    `);
    expect(r.invoiceNumber).toBe("INV-88123");
    expect(r.invoiceDate).toBe("2026-03-02");
    expect(r.netAmount).toBe("1000.00");
    expect(r.vatAmount).toBe("210.00");
    expect(r.grossAmount).toBe("1210.00");
    expect(r.reverseCharge).toBe(false);
  });

  it("does not take a VAT rate for an amount", () => {
    const r = parseInvoiceText("Totaal excl. btw 50,00\nBTW 21,00 %\nTe betalen 50,00");
    expect(r.vatAmount).toBeUndefined();
    expect(r.netAmount).toBe("50.00");
    expect(r.grossAmount).toBe("50.00");
  });

  it("returns an empty, zero-confidence result for unrelated text", () => {
    const r = parseInvoiceText("Hello world, nothing to see here.");
    expect(r.found).toEqual([]);
    expect(r.confidence).toBe(0);
  });
});
