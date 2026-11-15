import { prisma } from "@/lib/db";
import { company } from "@/lib/company";
import { formatDate } from "@/lib/money";
import { renderFinancialPdf } from "./financialPdf";

// Render an invoice to a PDF Buffer with pdfkit (no headless browser needed).
// Layout: the Creafluxe logo + your address, the customer, a line table, a
// VAT breakdown, totals and payment terms. DRAFT invoices are watermarked so
// a not-yet-issued draft can never be mistaken for a legal invoice.
//
// The layout itself lives in ./financialPdf.ts (shared with credit notes);
// brand tokens, fonts and the logo are shared with the offer PDF — see
// src/server/pdf/brand.ts.

export async function renderInvoicePdf(invoiceId: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      order: true,
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const isDraft = invoice.status === "DRAFT";
  const number = invoice.invoiceNumber ?? "CONCEPT";

  const footerLines: string[] = [];
  if (company.iban) {
    footerLines.push(`Gelieve te betalen op ${company.iban} met vermelding "${number}".`);
  }
  footerLines.push("Betaalbaar binnen de vermelde termijn. Alle bedragen in euro.");

  return renderFinancialPdf({
    title: isDraft ? "FACTUUR (CONCEPT)" : "FACTUUR",
    number,
    metaLines: [
      `Factuurdatum ${formatDate(invoice.issueDate)}`,
      `Vervaldatum ${formatDate(invoice.dueDate)}`,
      `Bestelling #${invoice.order.orderNumber}`,
    ],
    billToLabel: "Factuur aan",
    customer: invoice.customer,
    lines: invoice.lines,
    sign: 1,
    isDraft,
    footerLines,
  });
}
