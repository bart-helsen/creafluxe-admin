import { prisma } from "@/lib/db";
import { company } from "@/lib/company";
import { isR2Configured, putObject } from "@/lib/r2";
import { nextInvoiceNumber } from "@/server/counters";

// Move an invoice DRAFT → ISSUED: assign the sequential, gapless invoiceNumber
// (docs/03) and stamp the issue/due dates. The number is drawn from the Counter
// INSIDE the same transaction, so a crash can never skip or duplicate a number.
//
// Phase 1 note: "ISSUED" here records that YOU have finalised the invoice (in
// Dexxter). Dexxter has no API (docs/06), so this app is not the legal issuer —
// but it keeps its own correct, gapless numbering and reconciles via dexxterRef.

export async function issueInvoice(invoiceId: string): Promise<string> {
  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + company.paymentTermDays);
  const year = now.getUTCFullYear();

  const invoiceNumber = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status !== "DRAFT") {
      throw new Error(
        `Invoice ${invoiceId} is ${invoice.status}, only DRAFT invoices can be issued.`,
      );
    }

    const number = await nextInvoiceNumber(year, tx);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceNumber: number,
        status: "ISSUED",
        issueDate: now,
        dueDate,
      },
    });
    return number;
  });

  // Re-render the PDF now that it has a number and no draft watermark.
  try {
    if (isR2Configured()) {
      const { renderInvoicePdf } = await import("./renderInvoicePdf");
      const pdf = await renderInvoicePdf(invoiceId);
      const key = `invoices/${invoiceId}.pdf`;
      await putObject(key, pdf, "application/pdf");
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfStorageKey: key },
      });
    }
  } catch (err) {
    console.error(`[invoice] PDF re-render failed for ${invoiceId}:`, err);
  }

  return invoiceNumber;
}
