import { prisma } from "@/lib/db";
import { formatEUR, money } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";
import { ManualOrderError, priceManualLines } from "@/server/orders/createManualOrder";
import type { OrderItemsUpdateInput } from "@/lib/validation";

// "Bestelling bewerken": change the lines of an existing order — prices,
// quantities, options, add or remove lines — e.g. after a catalogue price
// change or when the customer adds something later.
//
// Rules:
// - Only while the invoice is still a DRAFT (or there is none). An issued
//   invoice has a fixed number and amount and is never rewritten.
// - Lines with uploaded design files can be changed but not removed (removing
//   them would delete the customer's files).
// - Every edit is logged in the status timeline with old → new total.
// - The draft invoice is rebuilt from the new lines.

export async function updateOrderItems(params: {
  orderId: string;
  input: OrderItemsUpdateInput;
  userId: string;
}): Promise<{ oldTotal: string; newTotal: string }> {
  const { orderId, input, userId } = params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      invoice: { select: { status: true } },
      items: { include: { _count: { select: { customDesigns: true } } } },
    },
  });
  if (!order) throw new ManualOrderError("Bestelling niet gevonden.");
  assertEditable(order.invoice);

  if (input.items.length === 0 && !(order.type === "CUSTOM" && order.designBrief)) {
    throw new ManualOrderError("Een bestelling heeft minstens één artikel nodig.");
  }

  // Lines must belong to this order; lines with design files must stay.
  const existingById = new Map(order.items.map((it) => [it.id, it]));
  for (const it of input.items) {
    if (it.id && !existingById.has(it.id)) {
      throw new ManualOrderError("Een lijn hoort niet bij deze bestelling. Herlaad de pagina.");
    }
  }
  const keptIds = new Set(input.items.map((it) => it.id).filter(Boolean));
  const removed = order.items.filter((it) => !keptIds.has(it.id));
  const withFiles = removed.find((it) => it._count.customDesigns > 0);
  if (withFiles) {
    throw new ManualOrderError(
      `"${withFiles.nameSnapshot}" heeft ontwerpbestanden en kan niet verwijderd worden.`,
    );
  }

  const lines = await priceManualLines(input.items);
  const totals = computeInvoiceTotals(
    lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, vatRate: l.vatRate })),
  );
  if (money(totals.total).isNegative()) {
    throw new ManualOrderError("Het totaal van de bestelling kan niet negatief zijn.");
  }

  const oldTotal = order.total.toFixed(2);
  const newTotal = money(totals.total).toFixed(2);

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: the invoice may have been issued meanwhile.
    const invoice = await tx.invoice.findUnique({
      where: { orderId },
      select: { status: true },
    });
    assertEditable(invoice);

    if (removed.length) {
      await tx.orderItem.deleteMany({
        where: { id: { in: removed.map((it) => it.id) }, orderId },
      });
    }

    for (let i = 0; i < input.items.length; i++) {
      const id = input.items[i].id;
      const data = lines[i];
      if (id) {
        await tx.orderItem.update({ where: { id }, data });
      } else {
        await tx.orderItem.create({ data: { ...data, orderId } });
      }
    }

    await tx.order.update({
      where: { id: orderId },
      data: { subtotal: totals.subtotal, total: totals.total },
    });

    const summary =
      oldTotal === newTotal
        ? "Artikelen aangepast (totaal ongewijzigd)"
        : `Artikelen/prijzen aangepast: ${formatEUR(oldTotal)} → ${formatEUR(newTotal)}`;
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        // Same from/to status marks this as an edit, not a status change.
        fromStatus: order.status,
        toStatus: order.status,
        note: [summary, input.note].filter(Boolean).join(" — "),
        changedById: userId,
      },
    });
  });

  // Keep the draft invoice in line with the order.
  try {
    await createDraftInvoice(orderId);
  } catch (err) {
    console.error(`[order-edit] draft invoice refresh failed for ${orderId}:`, err);
  }

  return { oldTotal, newTotal };
}

function assertEditable(invoice: { status: string } | null) {
  if (invoice && invoice.status !== "DRAFT") {
    throw new ManualOrderError(
      "De factuur is al uitgereikt — deze bestelling kan niet meer aangepast worden. " +
        "Maak een creditnota of een aparte bestelling voor het verschil.",
    );
  }
}
