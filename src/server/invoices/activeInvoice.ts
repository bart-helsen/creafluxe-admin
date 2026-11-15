import type { Prisma } from "@prisma/client";

// An order can hold several invoices: cancelled ones (each with a credit note)
// stay as history, and at most one is "active" — the one that is not
// CANCELLED. Everything that means "the order's invoice" uses this filter.

export const ACTIVE_INVOICE_WHERE = {
  status: { not: "CANCELLED" },
} satisfies Prisma.InvoiceWhereInput;

/** The active invoice from a list of an order's invoices, or null. */
export function pickActiveInvoice<T extends { status: string }>(
  invoices: T[],
): T | null {
  return invoices.find((inv) => inv.status !== "CANCELLED") ?? null;
}
