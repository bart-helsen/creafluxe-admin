import {
  isEuCountry,
  normalizeInvoiceNumber,
  normalizeVatNumber,
  toCents,
  type PurchaseVatTreatmentValue,
} from "@/lib/purchases";

// Sanity checks for a purchase invoice. They FLAG, they never block: the review
// form shows them live while you type, and the list/quarter views show them as
// a warning marker. Pure and client-safe (no Prisma), so the same function runs
// in the browser and on the server — and is unit-tested.

export interface PurchaseCheckInput {
  supplierName?: string | null;
  supplierCountry?: string | null; // ISO alpha-2
  supplierVatNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null; // YYYY-MM-DD
  currency?: string | null;
  netAmount?: string | null;
  vatAmount?: string | null;
  grossAmount?: string | null;
  amountEur?: string | null;
  vatTreatment?: PurchaseVatTreatmentValue | null;
}

export type PurchaseFlagCode =
  | "TOTAL_MISMATCH"
  | "VAT_NUMBER_FORMAT"
  | "VAT_NUMBER_COUNTRY"
  | "DUPLICATE"
  | "DATE_FAR_PAST"
  | "DATE_FUTURE"
  | "EU_VAT_CHARGED"
  | "TREATMENT_COUNTRY"
  | "MISSING_EUR";

export interface PurchaseFlag {
  code: PurchaseFlagCode;
  message: string;
}

/** An invoice dated more than this many days ago is flagged. */
export const FAR_PAST_DAYS = 180;
/** An invoice dated more than this many days ahead is flagged. */
export const FUTURE_DAYS = 7;

/**
 * VAT number shape per country, WITHOUT the 2-letter prefix. Deliberately a
 * format check only (it can't tell whether the number exists — VIES does that).
 * Greece uses the prefix "EL" instead of its ISO code "GR".
 */
const VAT_PATTERNS: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  GR: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

/** The prefix a VAT number from this country starts with (GR → EL). */
export function vatPrefixFor(country: string): string {
  const c = country.toUpperCase();
  return c === "GR" ? "EL" : c;
}

/** The country a VAT number's prefix points at (EL → GR), or null. */
export function countryFromVatNumber(vat: string | null | undefined): string | null {
  const v = normalizeVatNumber(vat);
  if (!v || v.length < 4) return null;
  const prefix = v.slice(0, 2);
  const country = prefix === "EL" ? "GR" : prefix;
  return country in VAT_PATTERNS ? country : null;
}

/**
 * Does this VAT number look right for this country? Returns null when we have
 * no rule (e.g. a non-EU country), so unknown cases are never flagged.
 */
export function vatNumberMatchesCountry(
  vat: string,
  country: string,
): { ok: true } | { ok: false; reason: "prefix" | "format" } | null {
  const c = country.toUpperCase();
  const pattern = VAT_PATTERNS[c];
  if (!pattern) return null;
  const v = normalizeVatNumber(vat) ?? "";
  const prefix = vatPrefixFor(c);
  if (!v.startsWith(prefix)) return { ok: false, reason: "prefix" };
  return pattern.test(v.slice(prefix.length)) ? { ok: true } : { ok: false, reason: "format" };
}

function dayNumber(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

export interface DuplicateCandidate {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
}

/**
 * Other invoices with the same supplier and invoice number (compared without
 * spaces/dashes/case). Same supplier = same supplierId when both have one,
 * otherwise the same name.
 */
export function findDuplicates(
  current: DuplicateCandidate,
  others: DuplicateCandidate[],
): DuplicateCandidate[] {
  const number = normalizeInvoiceNumber(current.invoiceNumber);
  if (!number) return [];
  const name = current.supplierName?.trim().toLowerCase() || null;
  return others.filter((o) => {
    if (o.id === current.id) return false;
    if (normalizeInvoiceNumber(o.invoiceNumber) !== number) return false;
    if (current.supplierId && o.supplierId) return current.supplierId === o.supplierId;
    const otherName = o.supplierName?.trim().toLowerCase() || null;
    return !!name && name === otherName;
  });
}

/**
 * All warnings for one invoice. `today` is a YYYY-MM-DD date (Brussels);
 * `duplicates` comes from findDuplicates (or a DB query on the server).
 */
export function checkPurchaseInvoice(
  input: PurchaseCheckInput,
  context: { today: string; duplicates?: { id: string }[] },
): PurchaseFlag[] {
  const flags: PurchaseFlag[] = [];
  const country = input.supplierCountry?.toUpperCase() || null;

  // 1. net + VAT must equal gross.
  const net = toCents(input.netAmount);
  const vat = toCents(input.vatAmount);
  const gross = toCents(input.grossAmount);
  if (net != null && gross != null && net + (vat ?? 0) !== gross) {
    const diff = (gross - net - (vat ?? 0)) / 100;
    flags.push({
      code: "TOTAL_MISMATCH",
      message: `Netto + btw ≠ bruto (verschil ${diff.toFixed(2).replace(".", ",")}).`,
    });
  }

  // 2. VAT number vs country.
  if (input.supplierVatNumber && country) {
    const match = vatNumberMatchesCountry(input.supplierVatNumber, country);
    if (match && !match.ok) {
      flags.push(
        match.reason === "prefix"
          ? {
              code: "VAT_NUMBER_COUNTRY",
              message: `Btw-nummer begint niet met ${vatPrefixFor(country)} (land ${country}).`,
            }
          : {
              code: "VAT_NUMBER_FORMAT",
              message: `Btw-nummer heeft niet het gebruikelijke formaat voor ${country}.`,
            },
      );
    }
  }

  // 3. Duplicate (same supplier + invoice number).
  if (context.duplicates && context.duplicates.length > 0) {
    flags.push({
      code: "DUPLICATE",
      message:
        context.duplicates.length === 1
          ? "Er bestaat al een inkoopfactuur met dit nummer van deze leverancier."
          : `Er bestaan al ${context.duplicates.length} inkoopfacturen met dit nummer van deze leverancier.`,
    });
  }

  // 4. Invoice date far in the past or in the future.
  if (input.invoiceDate) {
    const d = dayNumber(input.invoiceDate);
    const t = dayNumber(context.today);
    if (d != null && t != null) {
      if (t - d > FAR_PAST_DAYS) {
        flags.push({
          code: "DATE_FAR_PAST",
          message: `Factuurdatum ligt meer dan ${FAR_PAST_DAYS} dagen in het verleden.`,
        });
      } else if (d - t > FUTURE_DAYS) {
        flags.push({ code: "DATE_FUTURE", message: "Factuurdatum ligt in de toekomst." });
      }
    }
  }

  // 5. EU supplier (outside Belgium) but VAT was charged.
  if (country && country !== "BE" && isEuCountry(country) && vat != null && vat > 0) {
    flags.push({
      code: "EU_VAT_CHARGED",
      message:
        "EU-leverancier buiten België, maar er werd btw aangerekend. Gaf je je btw-nummer op bij de bestelling?",
    });
  }

  // 6. VAT treatment that doesn't fit the supplier's country.
  if (country && input.vatTreatment) {
    const t = input.vatTreatment;
    const eu = isEuCountry(country);
    if (t === "EU_REVERSE_CHARGE" && (country === "BE" || !eu)) {
      flags.push({
        code: "TREATMENT_COUNTRY",
        message:
          country === "BE"
            ? "‘EU — btw verlegd’ gekozen voor een Belgische leverancier."
            : "‘EU — btw verlegd’ gekozen voor een leverancier buiten de EU.",
      });
    } else if (t === "NON_EU_IMPORT" && eu) {
      flags.push({
        code: "TREATMENT_COUNTRY",
        message: "‘Buiten EU’ gekozen voor een leverancier in de EU.",
      });
    } else if (t === "BELGIAN_VAT" && country !== "BE") {
      flags.push({
        code: "TREATMENT_COUNTRY",
        message: "‘Belgische btw’ gekozen voor een leverancier buiten België.",
      });
    }
  }

  // 7. Foreign currency without an EUR equivalent.
  if (input.currency && input.currency.toUpperCase() !== "EUR" && toCents(input.amountEur) == null) {
    flags.push({
      code: "MISSING_EUR",
      message: "Factuur in vreemde munt zonder bedrag in EUR (nodig voor het kwartaaltotaal).",
    });
  }

  return flags;
}

/** Today's date in Brussels as YYYY-MM-DD. */
export function todayInBrussels(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
