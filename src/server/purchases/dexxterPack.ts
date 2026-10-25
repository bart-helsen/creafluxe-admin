import {
  PURCHASE_CATEGORY_LABELS,
  VAT_TREATMENT_LABELS,
  type PurchaseCategoryValue,
  type PurchaseVatTreatmentValue,
} from "@/lib/purchases";

// The "Dexxter pack": every CHECKED-but-not-uploaded invoice file, renamed
// consistently (YYYY-MM-DD_supplier_invoicenumber.pdf) so the Dexxter upload
// is a drag-and-drop, plus a summary CSV of the confirmed fields to cross-check
// against. Pure helpers here; the route streams the zip.

export interface PackInvoice {
  id: string;
  supplierName: string | null;
  supplierCountry: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  receivedAt: string; // YYYY-MM-DD
  currency: string;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  amountEur: string | null;
  vatTreatment: PurchaseVatTreatmentValue;
  category: PurchaseCategoryValue;
  notes: string | null;
  fileName: string | null;
  mimeType: string | null;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Strip accents and anything that isn't a letter/digit; words joined by "-". */
function slug(value: string, maxLength: number, lowercase: boolean): string {
  const s = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return lowercase ? s.toLowerCase() : s;
}

/** File extension for the stored file: from its MIME type, else its name, else pdf. */
export function packExtension(mimeType: string | null, fileName: string | null): string {
  if (mimeType && EXTENSIONS[mimeType]) return EXTENSIONS[mimeType];
  const fromName = fileName?.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : "pdf";
}

/**
 * "2026-03-14_acme-gmbh_RE-2026-0042.pdf". Missing pieces get a readable
 * placeholder so the pattern (and the sort order by date) always holds.
 */
export function packFileName(
  inv: Pick<PackInvoice, "invoiceDate" | "supplierName" | "invoiceNumber" | "mimeType" | "fileName">,
): string {
  const date = inv.invoiceDate ?? "0000-00-00";
  const supplier = (inv.supplierName && slug(inv.supplierName, 40, true)) || "onbekend";
  const number = (inv.invoiceNumber && slug(inv.invoiceNumber, 40, false)) || "zonder-nummer";
  return `${date}_${supplier}_${number}.${packExtension(inv.mimeType, inv.fileName)}`;
}

/** Make names unique within one zip: a second "x.pdf" becomes "x-2.pdf". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
  });
}

/** "1234.56" → "1234,56" (Belgian Excel opens semicolon CSV with comma decimals). */
function csvAmount(v: string | null): string {
  return v == null ? "" : v.replace(".", ",");
}

function csvCell(v: string): string {
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const CSV_HEADER = [
  "Bestand",
  "Leverancier",
  "Land",
  "Btw-nummer",
  "Factuurnummer",
  "Factuurdatum",
  "Ontvangen",
  "Munt",
  "Netto",
  "Btw",
  "Bruto",
  "Bruto EUR",
  "Btw-behandeling",
  "Categorie",
  "Notities",
];

/**
 * Summary CSV: semicolon-separated with comma decimals and a UTF-8 BOM, so it
 * opens straight into columns in a Belgian Excel. `fileNames[i]` is the name
 * invoice i got in the zip ("" when it has no file).
 */
export function buildPackCsv(invoices: PackInvoice[], fileNames: string[]): string {
  const lines = [CSV_HEADER.join(";")];
  invoices.forEach((inv, i) => {
    const row = [
      fileNames[i] ?? "",
      inv.supplierName ?? "",
      inv.supplierCountry ?? "",
      inv.supplierVatNumber ?? "",
      inv.invoiceNumber ?? "",
      inv.invoiceDate ?? "",
      inv.receivedAt,
      inv.currency,
      csvAmount(inv.netAmount),
      csvAmount(inv.vatAmount),
      csvAmount(inv.grossAmount),
      csvAmount(inv.currency === "EUR" ? inv.grossAmount : inv.amountEur),
      VAT_TREATMENT_LABELS[inv.vatTreatment],
      PURCHASE_CATEGORY_LABELS[inv.category],
      (inv.notes ?? "").replace(/\r?\n/g, " "),
    ];
    lines.push(row.map(csvCell).join(";"));
  });
  return "﻿" + lines.join("\r\n") + "\r\n";
}
