import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { company } from "@/lib/company";
import { normalizeVatNumber } from "@/lib/purchases";
import { parseInvoiceText, type ParsedInvoiceText } from "@/server/purchases/parseInvoiceText";

// Local, free prefill for a newly received invoice. Reads the PDF's embedded
// text with unpdf (Mozilla pdf.js, runs in-process — nothing leaves the server),
// pattern-matches the obvious fields, and recognises a known supplier by VAT
// number or name. Any failure (scanned PDF without text, photo, broken file,
// library problem) returns null and the review form simply starts empty.

export interface Extraction extends ParsedInvoiceText {
  version: 1;
  pages: number;
  textLength: number;
  /** A known supplier recognised in the text (by VAT number, else by name). */
  supplierId?: string;
  supplierName?: string;
}

const MAX_TEXT = 200_000;

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number } | null> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: String(text).slice(0, MAX_TEXT), pages: totalPages };
}

export async function extractFromFile(
  bytes: Buffer,
  mimeType: string,
): Promise<Extraction | null> {
  if (mimeType !== "application/pdf") return null; // photos: no OCR, by design
  try {
    // pdf.js may detach the buffer it is given; hand it a copy.
    const read = await pdfText(new Uint8Array(bytes));
    if (!read || read.text.trim().length < 20) return null;

    const parsed = parseInvoiceText(read.text, {
      ownVatNumbers: company.vatNumber ? [company.vatNumber] : [],
    });
    const extraction: Extraction = {
      version: 1,
      pages: read.pages,
      textLength: read.text.length,
      ...parsed,
    };

    // Recognise a supplier you already know.
    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true, vatNumber: true },
    });
    const vat = normalizeVatNumber(parsed.supplierVatNumber);
    const lower = read.text.toLowerCase();
    const match =
      (vat && suppliers.find((s) => normalizeVatNumber(s.vatNumber) === vat)) ||
      suppliers
        .filter((s) => s.name.trim().length >= 3 && lower.includes(s.name.trim().toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];
    if (match) {
      extraction.supplierId = match.id;
      extraction.supplierName = match.name;
    }
    return extraction;
  } catch (err) {
    console.warn("[purchases] text extraction skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function extractionJson(e: Extraction | null): Prisma.InputJsonValue | undefined {
  return e ? (JSON.parse(JSON.stringify(e)) as Prisma.InputJsonValue) : undefined;
}

/** Read a stored extraction back (tolerant of older/unknown shapes). */
export function readExtraction(value: Prisma.JsonValue | null): Extraction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.version === 1 ? (v as unknown as Extraction) : null;
}
