import type { Customer, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toDecimal } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import { nextOrderNumber } from "@/server/counters";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";
import { MANUAL_ORDER_CHANNELS } from "@/lib/manual-order";
import type { ManualOrderInput, ManualOrderItemInput } from "@/lib/validation";

// Manual order ("Nieuwe bestelling" in the admin): for customers who ask you
// directly instead of ordering through the webshop. Same data model and the
// same automation as the website intake (order number, status timeline, draft
// invoice) — but the admin is trusted, so the prices entered are kept as-is
// and no "new order" e-mail is sent (you just created it yourself).

export class ManualOrderError extends Error {}

/** Resolve the customer: an existing one, or create / reuse by e-mail. */
async function resolveCustomer(
  db: Prisma.TransactionClient,
  input: ManualOrderInput["customer"],
): Promise<Customer> {
  if (input.mode === "existing") {
    const customer = await db.customer.findUnique({ where: { id: input.id } });
    if (!customer) throw new ManualOrderError("De gekozen klant bestaat niet meer.");
    return customer;
  }

  const data = {
    name: input.name,
    email: input.email ?? "",
    phone: input.phone,
    isBusiness: input.isBusiness,
    companyName: input.companyName,
    vatNumber: input.vatNumber,
    addressStreet: input.addressStreet,
    addressPostal: input.addressPostal,
    addressCity: input.addressCity,
    ...(input.addressCountry ? { addressCountry: input.addressCountry } : {}),
  };

  // Same rule as the website intake: one customer per e-mail address. If the
  // e-mail is already known, attach the order to that customer and only fill
  // in details that were still missing — never overwrite what's on file.
  if (input.email) {
    const existing = await db.customer.findFirst({
      where: { email: input.email },
    });
    if (existing) {
      const fill: Partial<typeof data> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        const current = existing[key];
        const incoming = data[key];
        if ((current === null || current === "") && incoming != null && incoming !== "") {
          (fill as Record<string, unknown>)[key] = incoming;
        }
      }
      return Object.keys(fill).length
        ? db.customer.update({ where: { id: existing.id }, data: fill })
        : existing;
    }
  }

  return db.customer.create({ data });
}

/**
 * Turn submitted lines into OrderItem data. Catalogue references are checked
 * and keep the product's own VAT rate; the entered price is kept as-is (the
 * admin is trusted). Shared by "Nieuwe bestelling" and "Bestelling bewerken".
 */
export async function priceManualLines(items: ManualOrderItemInput[]) {
  const productIds = items
    .map((it) => it.productId)
    .filter((id): id is string => !!id);
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  return items.map((it) => {
    const product = it.productId ? productById.get(it.productId) : undefined;
    if (it.productId && !product) {
      throw new ManualOrderError(`Product voor lijn "${it.name}" niet gevonden.`);
    }
    const unitPrice = money(it.unitPrice);
    return {
      productId: product?.id ?? null,
      nameSnapshot: it.name,
      unitPrice,
      quantity: it.quantity,
      lineTotal: money(unitPrice.mul(it.quantity)),
      // Catalogue items keep their own VAT rate; free lines use the chosen one.
      vatRate: product ? toDecimal(product.vatRate) : toDecimal(it.vatRate),
      material: it.material,
      size: it.size,
      style: it.style,
      design: it.design,
      remarks: it.remarks,
    };
  });
}

export async function createManualOrder(
  input: ManualOrderInput,
  userId: string,
): Promise<{ orderId: string; orderNumber: number }> {
  const lines = await priceManualLines(input.items);

  const totals = computeInvoiceTotals(
    lines.map((l) => ({
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      vatRate: l.vatRate,
    })),
  );

  if (money(totals.total).isNegative()) {
    throw new ManualOrderError("Het totaal van de bestelling kan niet negatief zijn.");
  }

  const delivery = input.delivery;
  const channelLabel = MANUAL_ORDER_CHANNELS[input.channel];

  const order = await prisma.$transaction(async (tx) => {
    // Customer + order in one transaction: a failed order never leaves a
    // half-created customer behind.
    const customer = await resolveCustomer(tx, input.customer);
    const orderNumber = await nextOrderNumber(tx);

    // Timeline: always start with "Nieuw" (created manually), then — if you
    // picked a later start status — a second event so the history is honest.
    // Explicit timestamps keep the two events in the right order.
    const createdNote = [`Manueel aangemaakt (${channelLabel.toLowerCase()})`, input.internalNote]
      .filter(Boolean)
      .join(" — ");
    const now = Date.now();
    const events: Prisma.OrderStatusEventCreateWithoutOrderInput[] = [
      {
        toStatus: "NEW",
        note: createdNote,
        changedBy: { connect: { id: userId } },
        createdAt: new Date(now),
      },
    ];
    if (input.initialStatus !== "NEW") {
      events.push({
        fromStatus: "NEW",
        toStatus: input.initialStatus,
        changedBy: { connect: { id: userId } },
        createdAt: new Date(now + 1),
      });
    }

    return tx.order.create({
      data: {
        orderNumber,
        type: input.type,
        status: input.initialStatus,
        channel: input.channel,
        customerId: customer.id,
        customerRemarks: input.customerRemarks,
        designBrief: input.designBrief,
        deliveryRequested: delivery.requested,
        deliveryStreet: delivery.requested ? delivery.street : null,
        deliveryPostal: delivery.requested ? delivery.postal : null,
        deliveryCity: delivery.requested ? delivery.city : null,
        deliveryCountry: delivery.requested ? delivery.country : null,
        deliveryNotes: delivery.requested ? delivery.notes : null,
        subtotal: totals.subtotal,
        total: totals.total,
        items: { create: lines },
        statusEvents: { create: events },
      },
    });
  });

  // Same draft invoice as a webshop order. Best-effort: the order is saved.
  try {
    await createDraftInvoice(order.id);
  } catch (err) {
    console.error(`[manual-order] draft invoice failed for order ${order.id}:`, err);
  }

  return { orderId: order.id, orderNumber: order.orderNumber };
}
