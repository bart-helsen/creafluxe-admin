import type { OrderItem, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isR2Configured, putObject } from "@/lib/r2";
import { computeInvoiceTotals } from "./invoiceMath";

// Flow 2 (docs/05): immediately after an order is saved, auto-generate a DRAFT
// invoice for your review. Phase 1 stops at the draft — you finalise the real
// invoice in Dexxter and paste its reference back (Invoice.dexxterRef). No
// invoiceNumber is assigned yet; that happens only at ISSUE time (gapless).

/** Human-readable line description from an order item's snapshot fields. */
export function describeOrderItem(item: {
  nameSnapshot: string;
  material: string | null;
  size: string | null;
  style: string | null;
  design: string | null;
}): string {
  const opts = [
    item.material && `Materiaal: ${item.material}`,
    item.size && `Maat: ${item.size}`,
    item.style && `Stijl: ${item.style}`,
    item.design && `Ontwerp: ${item.design}`,
  ].filter(Boolean);
  return opts.length ? `${item.nameSnapshot} (${opts.join(", ")})` : item.nameSnapshot;
}

/**
 * Create or regenerate the DRAFT invoice for an order. Idempotent: safe to call
 * again while the invoice is still a draft (it rebuilds the lines and totals).
 * Refuses to touch an invoice that has already been ISSUED.
 * Returns the invoice id.
 */
export async function createDraftInvoice(orderId: string): Promise<string> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, invoice: true },
  });
  if (!order) throw new Error(`Order ${orderId} not found`);

  if (order.invoice && order.invoice.status !== "DRAFT") {
    // Already finalised — never rewrite an issued invoice.
    return order.invoice.id;
  }

  const items = order.items;
  const totals = computeInvoiceTotals(
    items.map((it) => ({
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      vatRate: it.vatRate,
    })),
  );

  const lineData: Prisma.InvoiceLineCreateManyInvoiceInput[] = items.map(
    (it: OrderItem, i: number) => ({
      description: describeOrderItem(it),
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      vatRate: it.vatRate,
      lineTotal: totals.lineTotals[i],
      sortOrder: i,
    }),
  );

  const invoiceId = await prisma.$transaction(async (tx) => {
    if (order.invoice) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: order.invoice.id } });
      await tx.invoice.update({
        where: { id: order.invoice.id },
        data: {
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          lines: { createMany: { data: lineData } },
        },
      });
      return order.invoice.id;
    }
    const created = await tx.invoice.create({
      data: {
        status: "DRAFT",
        orderId: order.id,
        customerId: order.customerId,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        lines: { createMany: { data: lineData } },
      },
    });
    return created.id;
  });

  // Render + store the PDF (best effort; the draft is valid without it and the
  // PDF is regenerated on demand by GET /invoices/:id/pdf when R2 is off).
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
    console.error(`[invoice] PDF render/store failed for ${invoiceId}:`, err);
  }

  return invoiceId;
}
