import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isR2Configured, putObject } from "@/lib/r2";
import { nextCreditNoteNumber } from "@/server/counters";
import { computeInvoiceTotals } from "./invoiceMath";
import { InvoiceActionError } from "./deleteDraftInvoice";

// Cancel an issued invoice with a credit note (creditnota). Belgian invoices
// are numbered without gaps, so an issued invoice is never deleted or
// renumbered: a credit note with its own gapless number refers to it and
// credits it in full. The invoice becomes CANCELLED, which frees the order for
// a new draft invoice. The order itself is not touched.
//
// Phase 1 note: like invoices, the legal credit note is made in Dexxter; this
// keeps a matching record (with dexxterRef) and a PDF.

/** Statuses that can be credited. A paid invoice can be credited too (refund). */
const CREDITABLE: string[] = ["ISSUED", "SENT", "OVERDUE", "PAID"];

export async function cancelInvoiceWithCreditNote(params: {
  invoiceId: string;
  reason: string | null;
}): Promise<{ creditNoteId: string; creditNoteNumber: string; orderId: string }> {
  const { invoiceId, reason } = params;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { sortOrder: "asc" } }, creditNote: { select: { id: true } } },
    });
    if (!invoice) throw new InvoiceActionError("Factuur niet gevonden.");
    if (invoice.creditNote) {
      throw new InvoiceActionError("Deze factuur heeft al een creditnota.");
    }
    if (!invoice.invoiceNumber) {
      throw new InvoiceActionError(
        "Een concept heeft geen nummer en geen creditnota nodig — verwijder het concept.",
      );
    }
    // CANCELLED without a credit note = cancelled the old way (status only);
    // allow making the missing credit note for it.
    if (!CREDITABLE.includes(invoice.status) && invoice.status !== "CANCELLED") {
      throw new InvoiceActionError(`Een factuur met status ${invoice.status} kan niet gecrediteerd worden.`);
    }

    const totals = computeInvoiceTotals(
      invoice.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, vatRate: l.vatRate })),
    );
    const lineData: Prisma.CreditNoteLineCreateManyCreditNoteInput[] = invoice.lines.map((l, i) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      lineTotal: l.lineTotal,
      sortOrder: i,
    }));

    // Number drawn inside the transaction: if anything fails, it rolls back
    // and the number is not used (gapless).
    const number = await nextCreditNoteNumber(now.getUTCFullYear(), tx);
    const creditNote = await tx.creditNote.create({
      data: {
        creditNoteNumber: number,
        issueDate: now,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        reason,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        currency: invoice.currency,
        lines: { createMany: { data: lineData } },
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED" },
    });
    return { creditNoteId: creditNote.id, creditNoteNumber: number, orderId: invoice.orderId };
  });

  // Render + store the PDF (best effort; it is rendered on demand otherwise).
  try {
    if (isR2Configured()) {
      const { renderCreditNotePdf } = await import("./renderCreditNotePdf");
      const pdf = await renderCreditNotePdf(result.creditNoteId);
      const key = `credit-notes/${result.creditNoteId}.pdf`;
      await putObject(key, pdf, "application/pdf");
      await prisma.creditNote.update({
        where: { id: result.creditNoteId },
        data: { pdfStorageKey: key },
      });
    }
  } catch (err) {
    console.error(`[credit note] PDF render/store failed for ${result.creditNoteId}:`, err);
  }

  return result;
}
