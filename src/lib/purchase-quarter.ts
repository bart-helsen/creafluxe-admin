import {
  VAT_TREATMENTS,
  centsToAmount,
  toCents,
  type PurchaseStatusValue,
  type PurchaseVatTreatmentValue,
} from "@/lib/purchases";

// Quarter maths for the Inkoopfacturen quarter view: which dates fall in Q1–Q4,
// the reminder deadline, and totals per VAT treatment. Pure, client-safe and
// unit-tested.
//
// This is a cross-check aid, NOT a VAT return: no grid numbers and no tax
// rules live here. Verify every figure in Dexxter or with your accountant.

export type Quarter = 1 | 2 | 3 | 4;

/**
 * Filing-deadline REMINDER for a quarterly VAT return: the given day of the
 * month(s) after the quarter ends. A configurable assumption, shown in the UI
 * as "verify in Dexxter" — change it here if your deadline differs.
 */
export const VAT_RETURN_DEADLINE = {
  monthsAfterQuarterEnd: 1,
  dayOfMonth: 25,
};

const pad = (n: number) => String(n).padStart(2, "0");

export function isQuarter(n: number): n is Quarter {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

/** The quarter a YYYY-MM-DD date falls in. */
export function quarterOf(isoDate: string): { year: number; quarter: Quarter } {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y, quarter: (Math.floor((m - 1) / 3) + 1) as Quarter };
}

/**
 * First day of the quarter and first day of the NEXT quarter (exclusive end),
 * both YYYY-MM-DD. Use `gte start, lt endExclusive` so the last day is included
 * whatever the time of day.
 */
export function quarterRange(
  year: number,
  quarter: Quarter,
): { start: string; endExclusive: string; lastDay: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const start = `${year}-${pad(startMonth)}-01`;
  const endExclusive =
    quarter === 4 ? `${year + 1}-01-01` : `${year}-${pad(startMonth + 3)}-01`;
  const last = new Date(Date.UTC(year, startMonth + 2, 0)); // day 0 = last of prev month
  const lastDay = `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
  return { start, endExclusive, lastDay };
}

/** Reminder deadline for the quarter (see VAT_RETURN_DEADLINE), YYYY-MM-DD. */
export function quarterDeadline(
  year: number,
  quarter: Quarter,
  rule = VAT_RETURN_DEADLINE,
): string {
  const monthIndex = quarter * 3 - 1 + rule.monthsAfterQuarterEnd; // 0-based, may overflow
  const y = year + Math.floor(monthIndex / 12);
  const m = (monthIndex % 12) + 1;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(rule.dayOfMonth, daysInMonth))}`;
}

/** The previous quarter (for "last quarter" shortcuts). */
export function previousQuarter(year: number, quarter: Quarter): { year: number; quarter: Quarter } {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: (quarter - 1) as Quarter };
}

export interface QuarterInvoice {
  status: PurchaseStatusValue;
  vatTreatment: PurchaseVatTreatmentValue;
  currency: string;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  amountEur: string | null;
}

export interface TreatmentTotals {
  treatment: PurchaseVatTreatmentValue;
  count: number;
  /** EUR amounts as "1234.56" strings. */
  net: string;
  vat: string;
  gross: string;
  /** Converted from a foreign currency via amountEur (proportionally). */
  convertedCount: number;
  /** Foreign currency without amountEur — left OUT of the EUR totals. */
  missingEurCount: number;
  /** Not yet UPLOADED_TO_DEXXTER. */
  notUploadedCount: number;
}

/** EUR cents for one invoice, or null when it can't be expressed in EUR. */
export function eurCents(
  inv: Pick<QuarterInvoice, "currency" | "netAmount" | "vatAmount" | "grossAmount" | "amountEur">,
): { net: number; vat: number; gross: number; converted: boolean } | null {
  const net = toCents(inv.netAmount);
  const vat = toCents(inv.vatAmount) ?? 0;
  const gross = toCents(inv.grossAmount) ?? (net != null ? net + vat : null);
  if (gross == null) return null;
  const netOrGross = net ?? gross - vat;

  if (inv.currency.toUpperCase() === "EUR") {
    return { net: netOrGross, vat, gross, converted: false };
  }
  const grossEur = toCents(inv.amountEur);
  if (grossEur == null) return null;
  // Spread the EUR gross over net and VAT in the invoice's own proportions.
  const netEur = gross === 0 ? grossEur : Math.round((netOrGross * grossEur) / gross);
  return { net: netEur, vat: grossEur - netEur, gross: grossEur, converted: true };
}

/** Totals per VAT treatment (every treatment present, in enum order) + overall. */
export function summarizeByTreatment(invoices: QuarterInvoice[]): {
  rows: TreatmentTotals[];
  total: Omit<TreatmentTotals, "treatment">;
} {
  const acc = new Map<
    PurchaseVatTreatmentValue,
    { count: number; net: number; vat: number; gross: number; converted: number; missing: number; open: number }
  >();
  const blank = () => ({ count: 0, net: 0, vat: 0, gross: 0, converted: 0, missing: 0, open: 0 });
  const total = blank();

  for (const inv of invoices) {
    const row = acc.get(inv.vatTreatment) ?? blank();
    for (const r of [row, total]) {
      r.count += 1;
      if (inv.status !== "UPLOADED_TO_DEXXTER") r.open += 1;
      const eur = eurCents(inv);
      if (!eur) {
        r.missing += 1;
        continue;
      }
      r.net += eur.net;
      r.vat += eur.vat;
      r.gross += eur.gross;
      if (eur.converted) r.converted += 1;
    }
    acc.set(inv.vatTreatment, row);
  }

  const totals = (r: ReturnType<typeof blank>): Omit<TreatmentTotals, "treatment"> => ({
    count: r.count,
    net: centsToAmount(r.net),
    vat: centsToAmount(r.vat),
    gross: centsToAmount(r.gross),
    convertedCount: r.converted,
    missingEurCount: r.missing,
    notUploadedCount: r.open,
  });

  return {
    rows: VAT_TREATMENTS.filter((t) => acc.has(t)).map((t) => ({
      treatment: t,
      ...totals(acc.get(t)!),
    })),
    total: totals(total),
  };
}
