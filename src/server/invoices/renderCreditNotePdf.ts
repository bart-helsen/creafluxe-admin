import { prisma } from "@/lib/db";
import { formatDate, money } from "@/lib/money";
import { renderFinancialPdf } from "./financialPdf";

// Render a credit note to PDF: same layout as the invoice, amounts negative,
// with the mandatory reference to the credited invoice (number + date).

/** Mandatory mention on a credit note that corrects VAT (Belgian VAT rules). */
export const VAT_REFUND_MENTION =
  "Btw terug te storten aan de staat in de mate waarin ze oorspronkelijk in aftrek werd gebracht.";

export async function renderCreditNotePdf(creditNoteId: string): Promise<Buffer> {
  const cn = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    include: {
      customer: true,
      invoice: { include: { order: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!cn) throw new Error(`Credit note ${creditNoteId} not found`);

  const invNumber = cn.invoice.invoiceNumber ?? "—";
  const footerLines = [
    `Deze creditnota annuleert factuur ${invNumber} van ${formatDate(cn.invoice.issueDate)} volledig.`,
  ];
  if (cn.reason) footerLines.push(`Reden: ${cn.reason}`);
  if (money(cn.vatAmount).greaterThan(0)) footerLines.push(VAT_REFUND_MENTION);
  footerLines.push("Alle bedragen in euro.");

  return renderFinancialPdf({
    title: "CREDITNOTA",
    number: cn.creditNoteNumber,
    metaLines: [
      `Datum ${formatDate(cn.issueDate)}`,
      `Bij factuur ${invNumber} van ${formatDate(cn.invoice.issueDate)}`,
      `Bestelling #${cn.invoice.order.orderNumber}`,
    ],
    billToLabel: "Klant",
    customer: cn.customer,
    lines: cn.lines,
    sign: -1,
    isDraft: false,
    footerLines,
  });
}
