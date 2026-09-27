import PDFDocument from "pdfkit";
import { company, companyAddressLines } from "@/lib/company";
import { formatDate } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import {
  COLOR,
  LOGO_ASPECT,
  LOGO_PATH,
  drawLabel,
  eur,
  registerBrandFonts,
} from "@/server/pdf/brand";

// The offer PDF you download and send to the customer. Same Creafluxe look as
// the invoice (shared tokens in src/server/pdf/brand.ts): logo + your details,
// the customer, an optional greeting, the lines, VAT breakdown and totals with
// a "voor akkoord" box for the customer's signature beside them, then the
// conditions and validity.
//
// Kept free of database access (the caller passes plain data), so it can be
// rendered and checked on its own.

export interface OfferPdfData {
  offerNumber: string;
  version: number;
  date: Date;
  validUntil: Date | null;
  requestNumber: string;
  subject: string;
  customer: {
    name: string;
    companyName: string | null;
    vatNumber: string | null;
    email: string | null;
    phone: string | null;
    addressStreet: string | null;
    addressPostal: string | null;
    addressCity: string | null;
    addressCountry: string | null;
  };
  intro: string | null;
  terms: string | null;
  lines: {
    description: string;
    quantity: number;
    unitPrice: string; // incl. VAT
    vatRate: string;
    lineTotal: string; // incl. VAT
  }[];
}

export function buildOfferPdf(data: OfferPdfData): Promise<Buffer> {
  const totals = computeInvoiceTotals(
    data.lines.map((l) => ({
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      vatRate: l.vatRate,
    })),
  );
  // Lines show the VAT-inclusive prices that are stored (and that the invoice
  // will show), so quantity × price always adds up; the net subtotal and VAT
  // per rate follow below the table.

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: { Title: `Offerte ${data.offerNumber}`, Author: company.name },
    });
    registerBrandFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = 545;
    const width = right - left;
    const bottom = 770;
    const cols = { desc: left, qty: 340, unit: 400, vat: 465, total: right };

    const ensureSpace = (y: number, needed: number) => {
      if (y + needed <= bottom) return y;
      doc.addPage();
      return 60;
    };

    const drawTableHeader = (ty: number) => {
      doc.rect(left, ty - 6, width, 24).fill(COLOR.surfaceAlt);
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

    // --- Header: logo + seller details ---------------------------------------
    const logoW = 152;
    const logoH = logoW / LOGO_ASPECT;
    doc.image(LOGO_PATH, left, 46, { width: logoW });

    let y = 46 + logoH + 14;
    doc.font("Manrope-regular").fontSize(9).fillColor(COLOR.inkMuted);
    // Compact: contact details share lines so the header stays short.
    const sellerLines = [
      ...companyAddressLines(),
      [company.vatNumber && `BTW ${company.vatNumber}`, company.website]
        .filter(Boolean)
        .join(" · "),
      [company.email, company.phone].filter(Boolean).join(" · "),
    ].filter((l): l is string => Boolean(l));
    for (const line of sellerLines) {
      doc.text(line, left, y, { width: 260 });
      y += 12.5;
    }

    // --- Header: offer meta (right) -------------------------------------------
    const metaW = right - 300;
    drawLabel(doc, "Offerte", 300, 48, {
      width: metaW,
      align: "right",
      color: COLOR.orangeText,
    });
    doc.font("Manrope-semibold").fontSize(17).fillColor(COLOR.gray);
    doc.text(`Nr. ${data.offerNumber}`, 300, 62, { width: metaW, align: "right" });

    doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.inkMuted);
    const metaLines = [
      `Datum ${formatDate(data.date)}`,
      data.validUntil && `Geldig tot ${formatDate(data.validUntil)}`,
      `Aanvraag ${data.requestNumber}${data.version > 1 ? ` · versie ${data.version}` : ""}`,
    ].filter((l): l is string => Boolean(l));
    let my = 90;
    for (const line of metaLines) {
      doc.text(line, 300, my, { width: metaW, align: "right" });
      my += 13.5;
    }

    // --- Accent rule -------------------------------------------------------
    const ruleY = Math.max(y, my) + 14;
    doc
      .moveTo(left, ruleY)
      .lineTo(right, ruleY)
      .lineWidth(1.5)
      .strokeColor(COLOR.orange)
      .stroke();

    // --- Offer for (left) + subject (right) ------------------------------------
    let by = ruleY + 22;
    const topOfBlock = by;
    drawLabel(doc, "Offerte voor", left, by);
    by += 16;
    const c = data.customer;
    doc.font("Manrope-semibold").fontSize(11.5).fillColor(COLOR.gray);
    if (c.companyName) {
      doc.text(c.companyName, left, by, { width: 240 });
      by += 15;
    }
    doc.text(c.name, left, by, { width: 240 });
    by += 15;
    doc.font("Manrope-regular").fontSize(9).fillColor(COLOR.inkMuted);
    const custLines = [
      c.addressStreet,
      [c.addressPostal, c.addressCity].filter(Boolean).join(" "),
      c.addressStreet || c.addressCity ? c.addressCountry : null,
      c.vatNumber && `BTW ${c.vatNumber}`,
      c.email,
      c.phone,
    ].filter((l): l is string => Boolean(l && l.trim()));
    for (const line of custLines) {
      doc.text(line, left, by, { width: 240 });
      by += 12.5;
    }

    drawLabel(doc, "Betreft", 320, topOfBlock);
    doc.font("Manrope-semibold").fontSize(11.5).fillColor(COLOR.gray);
    doc.text(data.subject, 320, topOfBlock + 16, { width: right - 320 });
    const subjectBottom =
      topOfBlock + 16 + doc.heightOfString(data.subject, { width: right - 320 });

    y = Math.max(by, subjectBottom) + 18;

    // --- Intro ------------------------------------------------------------------
    if (data.intro?.trim()) {
      doc.font("Manrope-regular").fontSize(10).fillColor(COLOR.gray);
      const h = doc.heightOfString(data.intro.trim(), { width, lineGap: 2 });
      y = ensureSpace(y, h);
      doc.text(data.intro.trim(), left, y, { width, lineGap: 2 });
      y += h + 18;
    }

    // --- Lines -------------------------------------------------------------------
    y = ensureSpace(y, 60);
    let ty = drawTableHeader(y + 6);
    doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.gray);
    for (const line of data.lines) {
      const h = Math.max(16, doc.heightOfString(line.description, { width: 280 }) + 6);
      if (ty + h > bottom - 40) {
        doc.addPage();
        ty = drawTableHeader(60);
        doc.font("Manrope-regular").fontSize(9.5).fillColor(COLOR.gray);
      }
      doc.fillColor(COLOR.gray).text(line.description, cols.desc + 4, ty, { width: 280 });
      doc.fillColor(COLOR.inkMuted);
      doc.text(String(line.quantity), cols.qty, ty, { width: 50, align: "right" });
      doc.text(eur(line.unitPrice), cols.unit, ty, {
        width: 55,
        align: "right",
      });
      doc.text(`${Number(line.vatRate)}%`, cols.vat, ty, { width: 35, align: "right" });
      doc.fillColor(COLOR.gray);
      doc.text(eur(line.lineTotal), cols.total - 70, ty, {
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
    doc.font("Manrope-regular").fontSize(8).fillColor(COLOR.inkMuted);
    doc.text("Prijzen per stuk en lijntotalen incl. btw.", left + 4, ty + 2);
    ty += 16;

    // --- Totals + VAT breakdown (right) and "voor akkoord" (left) ------------------
    ty = ensureSpace(ty + 8, Math.max(96, 40 + 16 * (totals.vatByRate.length + 2)));
    const totalsTop = ty;
    const labelX = 330;
    const valX = right - 90;
    const row = (label: string, value: string, bold = false, color: string = COLOR.gray) => {
      doc.font(bold ? "Manrope-semibold" : "Manrope-regular").fontSize(bold ? 12 : 10);
      doc.fillColor(color);
      doc.text(label, labelX, ty, { width: 130, align: "right" });
      doc.text(value, valX, ty, { width: 90, align: "right" });
      ty += bold ? 20 : 16;
    };
    row("Subtotaal (excl. btw)", eur(totals.subtotal));
    for (const b of totals.vatByRate) row(`Btw ${Number(b.vatRate)}%`, eur(b.vat));
    ty += 4;
    doc
      .moveTo(labelX + 10, ty - 2)
      .lineTo(right, ty - 2)
      .lineWidth(1.25)
      .strokeColor(COLOR.orange)
      .stroke();
    ty += 8;
    row("Totaal (incl. btw)", eur(totals.total), true, COLOR.orangeText);

    // The customer signs next to the total they agree to.
    const boxW = 230;
    drawLabel(doc, "Voor akkoord", left, totalsTop);
    doc.font("Manrope-regular").fontSize(8.5).fillColor(COLOR.inkMuted);
    doc.text("Datum, naam en handtekening", left, totalsTop + 14, { width: boxW });
    doc
      .rect(left, totalsTop + 30, boxW, 54)
      .lineWidth(0.75)
      .strokeColor(COLOR.inkMuted)
      .strokeOpacity(0.5)
      .stroke();
    doc.strokeOpacity(1);
    ty = Math.max(ty, totalsTop + 30 + 54);

    // --- Conditions + validity ------------------------------------------------------
    const terms = [
      data.terms?.trim(),
      data.validUntil && `Deze offerte is geldig tot ${formatDate(data.validUntil)}.`,
    ]
      .filter(Boolean)
      .join("\n");
    if (terms) {
      doc.font("Manrope-regular").fontSize(9).fillColor(COLOR.inkMuted);
      const h = doc.heightOfString(terms, { width, lineGap: 2 });
      ty = ensureSpace(ty + 22, h + 20);
      drawLabel(doc, "Voorwaarden", left, ty);
      ty += 16;
      doc.font("Manrope-regular").fontSize(9).fillColor(COLOR.inkMuted);
      doc.text(terms, left, ty, { width, lineGap: 2 });
      ty += h;
    }

    doc.end();
  });
}
