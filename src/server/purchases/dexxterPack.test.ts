import { describe, it, expect } from "vitest";
import { buildPackCsv, packExtension, packFileName, uniqueNames, type PackInvoice } from "./dexxterPack";
import { createZip, crc32 } from "./zip";

// The Dexxter pack is what you drag into Dexxter, so file names must follow the
// pattern exactly and the zip must open everywhere.

const base: PackInvoice = {
  id: "1",
  supplierName: "Holzhandel Müller GmbH",
  supplierCountry: "DE",
  supplierVatNumber: "DE123456789",
  invoiceNumber: "RE 2026/0042",
  invoiceDate: "2026-03-14",
  receivedAt: "2026-03-15",
  currency: "EUR",
  netAmount: "1234.50",
  vatAmount: null,
  grossAmount: "1234.50",
  amountEur: null,
  vatTreatment: "EU_REVERSE_CHARGE",
  category: "MATERIALS",
  notes: "Berken; 3mm",
  fileName: "Rechnung.PDF",
  mimeType: "application/pdf",
};

describe("packFileName", () => {
  it("builds YYYY-MM-DD_supplier_invoicenumber.pdf with safe characters", () => {
    expect(packFileName(base)).toBe("2026-03-14_holzhandel-muller-gmbh_RE-2026-0042.pdf");
  });

  it("uses placeholders for missing pieces so the pattern always holds", () => {
    expect(
      packFileName({ ...base, invoiceDate: null, supplierName: null, invoiceNumber: "  " }),
    ).toBe("0000-00-00_onbekend_zonder-nummer.pdf");
  });

  it("keeps a photo's extension", () => {
    expect(packFileName({ ...base, mimeType: "image/jpeg", fileName: "IMG_1.HEIC" })).toMatch(/\.jpg$/);
    expect(packExtension(null, "scan.png")).toBe("png");
    expect(packExtension(null, null)).toBe("pdf");
  });

  it("caps very long names", () => {
    const name = packFileName({ ...base, supplierName: "x".repeat(200), invoiceNumber: "9".repeat(200) });
    expect(name.length).toBeLessThanOrEqual(10 + 1 + 40 + 1 + 40 + 4);
  });
});

describe("uniqueNames", () => {
  it("suffixes repeats before the extension", () => {
    expect(uniqueNames(["a.pdf", "b.pdf", "A.pdf", "a.pdf"])).toEqual([
      "a.pdf",
      "b.pdf",
      "A-2.pdf",
      "a-3.pdf",
    ]);
  });
});

describe("buildPackCsv", () => {
  it("is semicolon-separated with comma decimals, a BOM and quoted cells", () => {
    const csv = buildPackCsv([base], ["2026-03-14_x.pdf"]);
    expect(csv.startsWith("﻿Bestand;Leverancier;")).toBe(true);
    const row = csv.split("\r\n")[1];
    expect(row).toContain(";1234,50;");
    expect(row).toContain('"Berken; 3mm"');
    expect(row).toContain("EU — btw verlegd");
    expect(row).toContain("Materialen");
  });

  it("fills 'Bruto EUR' from amountEur for foreign invoices", () => {
    const csv = buildPackCsv([{ ...base, currency: "USD", grossAmount: "120.00", amountEur: "110.00" }], [""]);
    expect(csv.split("\r\n")[1]).toContain(";120,00;110,00;");
  });
});

describe("createZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("writes stored entries and a consistent central directory", () => {
    const a = Buffer.from("%PDF-1.4 hello");
    const zip = createZip([
      { name: "2026-03-14_é.pdf", data: a, date: new Date(2026, 2, 14, 10, 0, 0) },
      { name: "samenvatting.csv", data: Buffer.from("x;y\r\n") },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(8)).toBe(0); // stored
    expect(zip.readUInt32LE(14)).toBe(crc32(a));
    const nameLen = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLen).toString("utf8")).toBe("2026-03-14_é.pdf");
    expect(zip.subarray(30 + nameLen, 30 + nameLen + a.length).equals(a)).toBe(true);

    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
    const cdOffset = zip.readUInt32LE(eocd + 16);
    expect(zip.readUInt32LE(cdOffset)).toBe(0x02014b50);
    expect(cdOffset + zip.readUInt32LE(eocd + 12)).toBe(eocd);
  });
});
