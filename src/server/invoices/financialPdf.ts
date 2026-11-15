import PDFDocument from "pdfkit";
import type { Customer, Prisma } from "@prisma/client";
import { money } from "@/lib/money";
import { companyAddressLines, company } from "@/lib/company";
import { computeInvoiceTotals, netUnitPrice } from "./invoiceMath";
import {
  COLOR,
  LOGO_ASPECT,
  LOGO_PATH,
  drawLabel,
  eur,
  registerBrandFonts,
} from "@/server/pdf/brand";

// Shared A4 layout for invoices and credit notes (pdfkit): logo + your address,
// document meta, the customer, a line table, a VAT breakdown and totals.
// A credit note uses the same layout with every amount shown negative.

export interface FinancialPdfLine {
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

export interface FinancialPdfOptions {
  title: string; // e.g. "FACTUUR", "CREDITNOTA"
  number: string;
  metaLines: string[]; // right-hand header lines under the number
  billToLabel: string;
  customer: Customer;
  lines: FinancialPdfLine[];
  /** -1 shows every amount negative (credit note). */
  sign: 1 | -1;
  isDraft: boolean;
  footerLines: string[];
}

export function renderFinancialPdf(opts: FinancialPdfOptions): Promise<Buffer> {
  const totals = computeInvoiceTotals(
    opts.lines.map((l) => ({
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      vatRate: l.vatRate,
    })),
  );
  const signed = (v: string) =>
    opts.sign === 1 ? v : money(v).negated().toFixed(2);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    registerBrandFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = 545;
    const cols = { desc: left, qty: 290, unit: 335, vat: 425, total: right };

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
      doc.text("OMSCHRIJVING", cols.desc + 4, ty, { width: 230, ...o });
      doc.text("AANTAL", cols.qty, ty, { width: 40, align: "right", ...o });
      doc.text("PRIJS EXCL. BTW", cols.unit, ty, { width: 85, align: "right", ...o });
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
    drawLabel(doc, opts.title, 300, 48, {
      width: metaW,
      align: "right",
      color: opts.isDraft ? COLOR.inkMuted : COLOR.orangeText,
    });
    doc.font("Manrope-semibold").fontSize(17).fillColor(COLOR.gray);
    doc.text(`Nr. ${opts.number}`, 300, 62, { width: metaW, align: "right" });

    doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.inkMuted);
    let my = 90;
    for (const line of opts.metaLines) {
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
    drawLabel(doc, opts.billToLabel, left, by);
    by += 16;
    const c = opts.customer;
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
    for (const line of opts.lines) {
      const h = Math.max(
        16,
        doc.heightOfString(line.description, { width: 230 }) + 6,
      );
      if (ty + h > 720) {
        doc.addPage();
        ty = drawTableHeader(60);
        doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.gray);
      }
      doc.fillColor(COLOR.gray).text(line.description, cols.desc + 4, ty, { width: 230 });
      doc.fillColor(COLOR.inkMuted);
      doc.text(String(line.quantity), cols.qty, ty, { width: 40, align: "right" });
      doc.text(eur(signed(netUnitPrice(line.unitPrice, line.vatRate))), cols.unit, ty, {
        width: 85,
        align: "right",
      });
      doc.text(`${Number(line.vatRate)}%`, cols.vat, ty, {
        width: 35,
        align: "right",
      });
      doc.fillColor(COLOR.gray);
      doc.text(eur(signed(line.lineTotal.toString())), cols.total - 70, ty, {
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
    row("Subtotaal (excl. btw)", eur(signed(totals.subtotal)));
    for (const b of totals.vatByRate) {
      row(`Btw ${Number(b.vatRate)}%`, eur(signed(b.vat)));
    }
    ty += 4;
    doc
      .moveTo(labelX - 10, ty - 2)
      .lineTo(right, ty - 2)
      .lineWidth(1.25)
      .strokeColor(COLOR.orange)
      .stroke();
    ty += 8;
    row("Totaal (incl. btw)", eur(signed(totals.total)), true, COLOR.orangeText);

    // --- Payment / footer --------------------------------------------------
    ty += 20;
    if (ty > 700) {
      doc.addPage();
      ty = 60;
    }
    doc.font("Manrope-regular").fontSize(8.5).fillColor(COLOR.inkMuted);
    for (const line of opts.footerLines) {
      doc.text(line, left, ty, { width: right - left });
      ty += Math.max(13, doc.heightOfString(line, { width: right - left }) + 2);
    }

    // Draft watermark, drawn last so it sits on top.
    if (opts.isDraft) {
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
