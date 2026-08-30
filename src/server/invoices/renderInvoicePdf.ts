import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db";
import { company, companyAddressLines } from "@/lib/company";
import { computeInvoiceTotals } from "./invoiceMath";
import { formatDate } from "@/lib/money";

// Render an invoice to a PDF Buffer with pdfkit (no headless browser needed).
// Layout: your header + VAT number, the customer, a line table, a VAT
// breakdown, totals and payment terms. DRAFT invoices are watermarked so a
// not-yet-issued draft can never be mistaken for a legal invoice.

const EUR = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});
const eur = (v: string | number) => EUR.format(Number(v));

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

  const totals = computeInvoiceTotals(
    invoice.lines.map((l) => ({
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      vatRate: l.vatRate,
    })),
  );

  const isDraft = invoice.status === "DRAFT";
  const title = isDraft ? "FACTUUR (CONCEPT)" : "FACTUUR";
  const number = invoice.invoiceNumber ?? "CONCEPT";

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = 545;

    // --- Header: seller ----------------------------------------------------
    doc.fontSize(22).fillColor("#16223a").text(company.name, left, 50);
    doc.fontSize(9).fillColor("#444");
    let y = 78;
    for (const line of companyAddressLines()) {
      doc.text(line, left, y);
      y += 12;
    }
    const sellerLines = [
      company.vatNumber && `BTW: ${company.vatNumber}`,
      company.email,
      company.website,
    ].filter((l): l is string => Boolean(l));
    for (const line of sellerLines) {
      doc.text(line, left, y);
      y += 12;
    }

    // --- Header: invoice meta (right) --------------------------------------
    doc.fontSize(18).fillColor("#16223a").text(title, 300, 50, {
      width: right - 300,
      align: "right",
    });
    doc.fontSize(10).fillColor("#000");
    doc.text(`Nummer: ${number}`, 300, 82, { width: right - 300, align: "right" });
    doc.text(`Factuurdatum: ${formatDate(invoice.issueDate)}`, 300, 96, {
      width: right - 300,
      align: "right",
    });
    doc.text(`Vervaldatum: ${formatDate(invoice.dueDate)}`, 300, 110, {
      width: right - 300,
      align: "right",
    });
    doc.text(`Bestelling: #${invoice.order.orderNumber}`, 300, 124, {
      width: right - 300,
      align: "right",
    });

    // --- Bill to -----------------------------------------------------------
    const c = invoice.customer;
    let by = 165;
    doc.fontSize(10).fillColor("#666").text("Factuur aan:", left, by);
    by += 15;
    doc.fontSize(11).fillColor("#000");
    if (c.companyName) {
      doc.text(c.companyName, left, by);
      by += 14;
    }
    doc.text(c.name, left, by);
    by += 14;
    doc.fontSize(9).fillColor("#444");
    const billLines = [
      c.addressStreet,
      [c.addressPostal, c.addressCity].filter(Boolean).join(" "),
      c.addressCountry,
      c.vatNumber && `BTW: ${c.vatNumber}`,
      c.email,
    ].filter((l): l is string => Boolean(l && l.trim()));
    for (const line of billLines) {
      doc.text(line, left, by);
      by += 12;
    }

    // --- Line table --------------------------------------------------------
    let ty = 250;
    const cols = { desc: left, qty: 340, unit: 400, vat: 465, total: right };
    doc.fontSize(9).fillColor("#fff");
    doc.rect(left, ty - 4, right - left, 20).fill("#16223a");
    doc.fillColor("#fff");
    doc.text("Omschrijving", cols.desc + 4, ty, { width: 280 });
    doc.text("Aantal", cols.qty, ty, { width: 50, align: "right" });
    doc.text("Prijs", cols.unit, ty, { width: 55, align: "right" });
    doc.text("BTW", cols.vat, ty, { width: 35, align: "right" });
    doc.text("Totaal", cols.total - 70, ty, { width: 70, align: "right" });
    ty += 22;

    doc.fillColor("#000").fontSize(9);
    for (const line of invoice.lines) {
      const h = Math.max(
        16,
        doc.heightOfString(line.description, { width: 280 }) + 4,
      );
      if (ty + h > 720) {
        doc.addPage();
        ty = 60;
      }
      doc.fillColor("#000").text(line.description, cols.desc + 4, ty, { width: 280 });
      doc.text(String(line.quantity), cols.qty, ty, { width: 50, align: "right" });
      doc.text(eur(line.unitPrice.toString()), cols.unit, ty, {
        width: 55,
        align: "right",
      });
      doc.text(`${Number(line.vatRate)}%`, cols.vat, ty, {
        width: 35,
        align: "right",
      });
      doc.text(eur(line.lineTotal.toString()), cols.total - 70, ty, {
        width: 70,
        align: "right",
      });
      ty += h;
      doc.moveTo(left, ty - 2).lineTo(right, ty - 2).strokeColor("#e5e7eb").stroke();
    }

    // --- Totals + VAT breakdown -------------------------------------------
    ty += 12;
    const labelX = 360;
    const valX = right - 90;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#000");
      doc.text(label, labelX, ty, { width: 100, align: "right" });
      doc.text(value, valX, ty, { width: 90, align: "right" });
      doc.font("Helvetica");
      ty += 16;
    };
    row("Subtotaal (excl. btw)", eur(totals.subtotal));
    for (const b of totals.vatByRate) {
      row(`Btw ${Number(b.vatRate)}%`, eur(b.vat));
    }
    ty += 2;
    row("Totaal (incl. btw)", eur(totals.total), true);

    // --- Payment / footer --------------------------------------------------
    ty += 24;
    if (ty > 700) {
      doc.addPage();
      ty = 60;
    }
    doc.fontSize(9).fillColor("#444");
    if (company.iban) {
      doc.text(
        `Gelieve te betalen op ${company.iban} met vermelding "${number}".`,
        left,
        ty,
      );
      ty += 14;
    }
    doc.text(
      "Betaalbaar binnen de vermelde termijn. Alle bedragen in euro.",
      left,
      ty,
    );

    // Draft watermark, drawn last so it sits on top.
    if (isDraft) {
      doc.save();
      doc.rotate(-30, { origin: [300, 400] });
      doc.fontSize(90).fillColor("#16223a").opacity(0.08);
      doc.text("CONCEPT", 80, 360, { align: "center", width: 440 });
      doc.restore();
      doc.opacity(1);
    }

    doc.end();
  });
}
