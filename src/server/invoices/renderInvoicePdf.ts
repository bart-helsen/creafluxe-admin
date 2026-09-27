import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db";
import { company, companyAddressLines } from "@/lib/company";
import { computeInvoiceTotals } from "./invoiceMath";
import { formatDate } from "@/lib/money";
import {
  COLOR,
  LOGO_ASPECT,
  LOGO_PATH,
  drawLabel,
  eur,
  registerBrandFonts,
} from "@/server/pdf/brand";

// Render an invoice to a PDF Buffer with pdfkit (no headless browser needed).
// Layout: the Creafluxe logo + your address, the customer, a line table, a
// VAT breakdown, totals and payment terms. DRAFT invoices are watermarked so
// a not-yet-issued draft can never be mistaken for a legal invoice.
//
// Brand tokens, fonts and the logo are shared with the offer PDF — see
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
    registerBrandFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = 545;
    const cols = { desc: left, qty: 340, unit: 400, vat: 465, total: right };

    /** Fill + rule the table header band; returns the y for the first row. */
    const drawTableHeader = (ty: number) => {
      doc.rect(left, ty - 6, right - left, 24).fill(COLOR.surfaceAlt);
      doc
        .moveTo(left, ty + 18)
        .lineTo(right, ty + 18)
        .lineWidth(1.25)
        .strokeColor(COLOR.orange)
        .stroke();
      doc.font("Manrope-semibold").fontSize(8.5).fillColor(COLOR.gray);
      const o = { characterSpacing: 0.6 };
      doc.text("OMSCHRIJVING", cols.desc + 4, ty, { width: 280, ...o });
      doc.text("AANTAL", cols.qty, ty, { width: 50, align: "right", ...o });
      doc.text("PRIJS", cols.unit, ty, { width: 55, align: "right", ...o });
      doc.text("BTW", cols.vat, ty, { width: 35, align: "right", ...o });
      doc.text("TOTAAL", cols.total - 70, ty, { width: 70, align: "right", ...o });
      return ty + 26;
    };

    // --- Header: logo + seller address ------------------------------------
    const logoW = 152;
    const logoH = logoW / LOGO_ASPECT;
    doc.image(LOGO_PATH, left, 46, { width: logoW });

    let y = 46 + logoH + 14;
    doc.font("Manrope-regular").fontSize(9).fillColor(COLOR.inkMuted);
    for (const line of companyAddressLines()) {
      doc.text(line, left, y, { width: 260 });
      y += 12.5;
    }
    const sellerLines = [
      company.vatNumber && `BTW ${company.vatNumber}`,
      company.email,
      company.website,
    ].filter((l): l is string => Boolean(l));
    for (const line of sellerLines) {
      doc.text(line, left, y, { width: 260 });
      y += 12.5;
    }

    // --- Header: invoice meta (right) --------------------------------------
    const metaW = right - 300;
    drawLabel(doc, title, 300, 48, {
      width: metaW,
      align: "right",
      color: isDraft ? COLOR.inkMuted : COLOR.orangeText,
    });
    doc.font("Manrope-semibold").fontSize(17).fillColor(COLOR.gray);
    doc.text(`Nr. ${number}`, 300, 62, { width: metaW, align: "right" });

    doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.inkMuted);
    const metaLines = [
      `Factuurdatum ${formatDate(invoice.issueDate)}`,
      `Vervaldatum ${formatDate(invoice.dueDate)}`,
      `Bestelling #${invoice.order.orderNumber}`,
    ];
    let my = 90;
    for (const line of metaLines) {
      doc.text(line, 300, my, { width: metaW, align: "right" });
      my += 13.5;
    }

    // --- Accent rule --------------------------------------------------------
    const ruleY = Math.max(y, my) + 14;
    doc
      .moveTo(left, ruleY)
      .lineTo(right, ruleY)
      .lineWidth(1.5)
      .strokeColor(COLOR.orange)
      .stroke();

    // --- Bill to -------------------------------------------------------------
    let by = ruleY + 22;
    drawLabel(doc, "Factuur aan", left, by);
    by += 16;
    const c = invoice.customer;
    doc.font("Manrope-semibold").fontSize(11.5).fillColor(COLOR.gray);
    if (c.companyName) {
      doc.text(c.companyName, left, by);
      by += 15;
    }
    doc.text(c.name, left, by);
    by += 15;
    doc.font("Manrope-regular").fontSize(9).fillColor(COLOR.inkMuted);
    const billLines = [
      c.addressStreet,
      [c.addressPostal, c.addressCity].filter(Boolean).join(" "),
      c.addressCountry,
      c.vatNumber && `BTW ${c.vatNumber}`,
      c.email,
    ].filter((l): l is string => Boolean(l && l.trim()));
    for (const line of billLines) {
      doc.text(line, left, by, { width: 300 });
      by += 12.5;
    }

    // --- Line table -----------------------------------------------------------
    let ty = drawTableHeader(by + 26);

    doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.gray);
    for (const line of invoice.lines) {
      const h = Math.max(
        16,
        doc.heightOfString(line.description, { width: 280 }) + 6,
      );
      if (ty + h > 720) {
        doc.addPage();
        ty = drawTableHeader(60);
        doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.gray);
      }
      doc.fillColor(COLOR.gray).text(line.description, cols.desc + 4, ty, { width: 280 });
      doc.fillColor(COLOR.inkMuted);
      doc.text(String(line.quantity), cols.qty, ty, { width: 50, align: "right" });
      doc.text(eur(line.unitPrice.toString()), cols.unit, ty, {
        width: 55,
        align: "right",
      });
      doc.text(`${Number(line.vatRate)}%`, cols.vat, ty, {
        width: 35,
        align: "right",
      });
      doc.fillColor(COLOR.gray);
      doc.text(eur(line.lineTotal.toString()), cols.total - 70, ty, {
        width: 70,
        align: "right",
      });
      ty += h;
      doc
        .moveTo(left, ty - 3)
        .lineTo(right, ty - 3)
        .lineWidth(0.75)
        .strokeColor(COLOR.inkMuted)
        .strokeOpacity(0.25)
        .stroke();
      doc.strokeOpacity(1);
      doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.gray);
    }

    // --- Totals + VAT breakdown ------------------------------------------------
    ty += 14;
    const labelX = 360;
    const valX = right - 90;
    const row = (label: string, value: string, bold = false, valueColor: string = COLOR.gray) => {
      doc.font(bold ? "Manrope-semibold" : "Manrope-regular").fontSize(bold ? 12 : 10);
      doc.fillColor(valueColor);
      doc.text(label, labelX, ty, { width: 100, align: "right" });
      doc.text(value, valX, ty, { width: 90, align: "right" });
      ty += bold ? 20 : 16;
    };
    doc.fillColor(COLOR.inkMuted);
    row("Subtotaal (excl. btw)", eur(totals.subtotal));
    for (const b of totals.vatByRate) {
      row(`Btw ${Number(b.vatRate)}%`, eur(b.vat));
    }
    ty += 4;
    doc
      .moveTo(labelX - 10, ty - 2)
      .lineTo(right, ty - 2)
      .lineWidth(1.25)
      .strokeColor(COLOR.orange)
      .stroke();
    ty += 8;
    row("Totaal (incl. btw)", eur(totals.total), true, COLOR.orangeText);

    // --- Payment / footer --------------------------------------------------
    ty += 20;
    if (ty > 700) {
      doc.addPage();
      ty = 60;
    }
    doc.font("Manrope-regular").fontSize(8.5).fillColor(COLOR.inkMuted);
    if (company.iban) {
      doc.text(
        `Gelieve te betalen op ${company.iban} met vermelding "${number}".`,
        left,
        ty,
      );
      ty += 13;
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
      doc.font("Manrope-bold").fontSize(90).fillColor(COLOR.gray).opacity(0.08);
      doc.text("CONCEPT", 80, 360, { align: "center", width: 440 });
      doc.restore();
      doc.opacity(1);
    }

    doc.end();
  });
}
