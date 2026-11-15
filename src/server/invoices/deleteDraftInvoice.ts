import { prisma } from "@/lib/db";
import { deleteObject, isR2Configured } from "@/lib/r2";

// Delete a DRAFT invoice. A draft has no invoice number yet, so removing it
// leaves no gap in the numbering. The order itself is not touched: afterwards
// it simply has no invoice, and "Concept aanmaken" on the order makes a new one.
// Issued invoices can never be deleted — they are cancelled with a credit note
// (see cancelInvoice.ts).

export class InvoiceActionError extends Error {}

export async function deleteDraftInvoice(invoiceId: string): Promise<{ orderId: string }> {
  const deleted = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, invoiceNumber: true, orderId: true, pdfStorageKey: true },
    });
    if (!invoice) throw new InvoiceActionError("Factuur niet gevonden.");
    if (invoice.status !== "DRAFT" || invoice.invoiceNumber) {
      throw new InvoiceActionError(
        "Enkel een concept kan verwijderd worden. Een uitgegeven factuur annuleer je met een creditnota.",
      );
    }
    // Lines (and any payments) cascade with the invoice.
    await tx.invoice.delete({ where: { id: invoice.id } });
    return invoice;
  });

  // Best effort: remove the stored draft PDF.
  if (deleted.pdfStorageKey && isR2Configured()) {
    try {
      await deleteObject(deleted.pdfStorageKey);
    } catch (err) {
      console.error(`[invoice] could not delete PDF ${deleted.pdfStorageKey}:`, err);
    }
  }

  return { orderId: deleted.orderId };
}
