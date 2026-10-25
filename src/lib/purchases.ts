// Labels and small helpers for purchase invoices (Inkoopfacturen). Shared by
// server code and client components (the review form), so this file stays free
// of Prisma / server imports — the same rule as lib/requests.ts.

export type PurchaseStatusValue = "RECEIVED" | "CHECKED" | "UPLOADED_TO_DEXXTER";
export type PurchaseVatTreatmentValue =
  | "EU_REVERSE_CHARGE"
  | "BELGIAN_VAT"
  | "NON_EU_IMPORT"
  | "NO_VAT_RECOVERABLE";
export type PurchaseCategoryValue = "MATERIALS" | "SOFTWARE" | "SHIPPING" | "OTHER";
export type PurchaseSourceValue = "UPLOAD" | "EMAIL";

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatusValue, string> = {
  RECEIVED: "Te controleren",
  CHECKED: "Klaar voor Dexxter",
  UPLOADED_TO_DEXXTER: "In Dexxter",
};

export const VAT_TREATMENTS: PurchaseVatTreatmentValue[] = [
  "EU_REVERSE_CHARGE",
  "BELGIAN_VAT",
  "NON_EU_IMPORT",
  "NO_VAT_RECOVERABLE",
];

export const VAT_TREATMENT_LABELS: Record<PurchaseVatTreatmentValue, string> = {
  EU_REVERSE_CHARGE: "EU — btw verlegd",
  BELGIAN_VAT: "Belgische btw",
  NON_EU_IMPORT: "Buiten EU (invoer)",
  NO_VAT_RECOVERABLE: "Geen aftrekbare btw",
};

export const PURCHASE_CATEGORIES: PurchaseCategoryValue[] = [
  "MATERIALS",
  "SOFTWARE",
  "SHIPPING",
  "OTHER",
];

export const PURCHASE_CATEGORY_LABELS: Record<PurchaseCategoryValue, string> = {
  MATERIALS: "Materialen",
  SOFTWARE: "Software",
  SHIPPING: "Verzending",
  OTHER: "Overige",
};

export const PURCHASE_SOURCE_LABELS: Record<PurchaseSourceValue, string> = {
  UPLOAD: "upload",
  EMAIL: "e-mail",
};

/** The tabs on the Inkoopfacturen list. "OPEN" = not yet uploaded to Dexxter. */
export const PURCHASE_BUCKETS = {
  OPEN: ["RECEIVED", "CHECKED"],
  RECEIVED: ["RECEIVED"],
  CHECKED: ["CHECKED"],
  UPLOADED: ["UPLOADED_TO_DEXXTER"],
  ALL: ["RECEIVED", "CHECKED", "UPLOADED_TO_DEXXTER"],
} satisfies Record<string, PurchaseStatusValue[]>;

export type PurchaseBucket = keyof typeof PURCHASE_BUCKETS;

export const PURCHASE_BUCKET_LABELS: Record<PurchaseBucket, string> = {
  OPEN: "Nog niet in Dexxter",
  RECEIVED: "Te controleren",
  CHECKED: "Klaar voor Dexxter",
  UPLOADED: "In Dexxter",
  ALL: "Alle",
};

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "DKK", "PLN", "CZK", "HUF", "RON"];

/** EU member states (ISO 3166 alpha-2) plus XI (Northern Ireland, goods). */
export const EU_COUNTRIES: Record<string, string> = {
  AT: "Oostenrijk",
  BE: "België",
  BG: "Bulgarije",
  CY: "Cyprus",
  CZ: "Tsjechië",
  DE: "Duitsland",
  DK: "Denemarken",
  EE: "Estland",
  ES: "Spanje",
  FI: "Finland",
  FR: "Frankrijk",
  GR: "Griekenland",
  HR: "Kroatië",
  HU: "Hongarije",
  IE: "Ierland",
  IT: "Italië",
  LT: "Litouwen",
  LU: "Luxemburg",
  LV: "Letland",
  MT: "Malta",
  NL: "Nederland",
  PL: "Polen",
  PT: "Portugal",
  RO: "Roemenië",
  SE: "Zweden",
  SI: "Slovenië",
  SK: "Slowakije",
  XI: "Noord-Ierland",
};

/** A few common non-EU supplier countries, for the country picker. */
export const OTHER_COUNTRIES: Record<string, string> = {
  CH: "Zwitserland",
  CN: "China",
  GB: "Verenigd Koninkrijk",
  NO: "Noorwegen",
  US: "Verenigde Staten",
};

export function isEuCountry(code: string | null | undefined): boolean {
  return !!code && code.toUpperCase() in EU_COUNTRIES;
}

export function countryLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const c = code.toUpperCase();
  return EU_COUNTRIES[c] ?? OTHER_COUNTRIES[c] ?? c;
}

/**
 * Parse an amount typed or printed the Belgian way ("1.234,56", "12,5"), the
 * English way ("1,234.56") or plain ("1234.56"), with an optional currency
 * sign. Returns a canonical "1234.56" string, or null when it isn't a number.
 * Uses strings, never floats, so it is safe to feed into Decimal.
 */
export function parseAmount(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = String(input)
    .trim()
    .replace(/[\s  ']/g, "")
    .replace(/^(€|EUR|USD|\$|£|GBP)/i, "")
    .replace(/(€|EUR|USD|\$|£|GBP)$/i, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal separator.
    s =
      lastComma > lastDot
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Only commas: "12,50" is a decimal; "1,250" (exactly 3 digits after a
    // single comma) is ambiguous — treat a lone comma as the decimal separator,
    // which is how amounts are typed in Belgium.
    const parts = s.split(",");
    s = parts.length === 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if (lastDot >= 0) {
    // Only dots: "12.50" decimal; "1.250.000" thousands.
    const parts = s.split(".");
    if (parts.length > 2) s = parts.join("");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  // Round half-up to cents on the string itself.
  let cents = BigInt(int) * 100n + BigInt((frac + "00").slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1n;
  const out = `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
  return negative && cents !== 0n ? `-${out}` : out;
}

/** "1234.56" → 123456 (integer cents), for exact comparisons. */
export function toCents(amount: string | null | undefined): number | null {
  const parsed = parseAmount(amount);
  if (parsed == null) return null;
  const negative = parsed.startsWith("-");
  const [int, frac] = parsed.replace("-", "").split(".");
  const cents = Number(int) * 100 + Number(frac);
  return negative ? -cents : cents;
}

/** 123456 → "1234.56". */
export function centsToAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const out = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${out}` : out;
}

/** Normalise a VAT number for storage/comparison: "de 123 456.789" → "DE123456789". */
export function normalizeVatNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length ? s : null;
}

/** Normalise an invoice number for duplicate detection. */
export function normalizeInvoiceNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length ? s : null;
}

/** A short label for lists: "Supplier · INV-123", falling back to the file name. */
export function purchaseTitle(p: {
  supplierName: string | null;
  invoiceNumber: string | null;
  fileName: string | null;
}): string {
  const parts = [p.supplierName, p.invoiceNumber].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return p.fileName ?? "Nieuwe inkoopfactuur";
}
