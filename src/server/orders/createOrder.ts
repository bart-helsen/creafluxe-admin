import { Prisma, type ProductOptionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toDecimal } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import { nextOrderNumber } from "@/server/counters";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";
import { notifyNewOrder } from "@/server/notifications/notifyNewOrder";
import type { IntakeInput, IntakeItemInput } from "@/lib/validation";

// Flow 1 (docs/05): turn a validated intake payload into a persisted Order,
// then fire the automation chain (draft invoice + notification). Catalogue
// lines are RE-PRICED server-side from the Product/ProductOption tables — the
// price the browser sends is never trusted (docs/04).

export interface CreateOrderResult {
  orderId: string;
  orderNumber: number;
  duplicate: boolean;
}

/** Guess a filename + mime type from an R2 storage key (all we get at intake). */
function assetFromKey(storageKey: string): {
  fileName: string;
  mimeType: string;
} {
  const fileName = storageKey.split("/").pop() || storageKey;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mime: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    ai: "application/postscript",
    eps: "application/postscript",
    dxf: "image/vnd.dxf",
    dwg: "image/vnd.dwg",
  };
  return { fileName, mimeType: mime[ext] ?? "application/octet-stream" };
}

/** Re-price one line from the catalogue; returns the authoritative values. */
async function priceLine(item: IntakeItemInput): Promise<{
  productId: string | null;
  nameSnapshot: string;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
}> {
  if (!item.sku) {
    // Fully custom line: keep the submitted price for your review.
    return {
      productId: null,
      nameSnapshot: item.name,
      unitPrice: money(item.unitPrice),
      vatRate: toDecimal(21),
    };
  }

  const product = await prisma.product.findUnique({
    where: { sku: item.sku },
    include: { options: { where: { active: true } } },
  });

  if (!product) {
    // Unknown SKU — treat as custom, keep submitted price (don't lose the order).
    return {
      productId: null,
      nameSnapshot: item.name,
      unitPrice: money(item.unitPrice),
      vatRate: toDecimal(21),
    };
  }

  // Base price + the price deltas of the chosen options.
  let unit = toDecimal(product.basePrice);
  const chosen: [ProductOptionType, string | null | undefined][] = [
    ["MATERIAL", item.material],
    ["SIZE", item.size],
    ["STYLE", item.style],
    ["DESIGN", item.design],
  ];
  for (const [type, value] of chosen) {
    if (!value) continue;
    const opt = product.options.find((o) => o.type === type && o.value === value);
    if (opt) unit = unit.add(opt.priceDelta);
  }

  return {
    productId: product.id,
    nameSnapshot: product.name,
    unitPrice: money(unit),
    vatRate: toDecimal(product.vatRate),
  };
}

export async function createOrder(
  input: IntakeInput,
): Promise<CreateOrderResult> {
  // Idempotency: a repeated POST with the same clientRef returns the first order
  // instead of creating a duplicate (docs/04 cross-cutting rules).
  if (input.clientRef) {
    const existing = await prisma.order.findUnique({
      where: { clientRef: input.clientRef },
    });
    if (existing) {
      return {
        orderId: existing.id,
        orderNumber: existing.orderNumber,
        duplicate: true,
      };
    }
  }

  // Find-or-create the customer by email; refresh contact details from intake.
  const email = input.customer.email.toLowerCase();
  const existingCustomer = await prisma.customer.findFirst({ where: { email } });
  const customerData = {
    name: input.customer.name,
    email,
    phone: input.customer.phone ?? undefined,
    isBusiness: input.customer.isBusiness,
    vatNumber: input.customer.vatNumber ?? undefined,
    companyName: input.customer.companyName ?? undefined,
  };
  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: customerData,
      })
    : await prisma.customer.create({ data: customerData });

  // Re-price every line before we persist anything.
  const priced = await Promise.all(input.items.map(priceLine));
  const lineTotals = input.items.map((it, i) =>
    money(priced[i].unitPrice.mul(it.quantity)),
  );
  const totals = computeInvoiceTotals(
    input.items.map((it, i) => ({
      unitPrice: priced[i].unitPrice,
      quantity: it.quantity,
      vatRate: priced[i].vatRate,
    })),
  );

  const orderId = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextOrderNumber(tx);
    const delivery = input.delivery;

    const order = await tx.order.create({
      data: {
        orderNumber,
        type: input.type,
        status: "NEW",
        channel: "website",
        clientRef: input.clientRef ?? undefined,
        customerId: customer.id,
        customerRemarks: input.customerRemarks ?? undefined,
        designBrief: input.designBrief ?? undefined,
        deliveryRequested: delivery?.requested ?? false,
        deliveryStreet: delivery?.street ?? undefined,
        deliveryPostal: delivery?.postal ?? undefined,
        deliveryCity: delivery?.city ?? undefined,
        deliveryCountry: delivery?.country ?? undefined,
        deliveryNotes: delivery?.notes ?? undefined,
        subtotal: totals.subtotal,
        total: totals.total,
        statusEvents: {
          create: { toStatus: "NEW", note: "Bestelling ontvangen via website" },
        },
      },
    });

    // Create each item and attach its uploaded custom design files.
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: priced[i].productId,
          nameSnapshot: priced[i].nameSnapshot,
          unitPrice: priced[i].unitPrice,
          quantity: it.quantity,
          lineTotal: lineTotals[i],
          vatRate: priced[i].vatRate,
          material: it.material ?? undefined,
          size: it.size ?? undefined,
          style: it.style ?? undefined,
          design: it.design ?? undefined,
          remarks: it.remarks ?? undefined,
          customDesigns: {
            create: it.uploadKeys.map((key) => {
              const { fileName, mimeType } = assetFromKey(key);
              return { kind: "CUSTOM" as const, storageKey: key, fileName, mimeType };
            }),
          },
        },
      });
    }

    return order.id;
  });

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  // Automation chain (Flows 2 & 3). Best-effort: the order is already saved, so
  // a failure here must never fail the intake — it's logged and surfaced later.
  try {
    await createDraftInvoice(orderId);
  } catch (err) {
    console.error(`[intake] draft invoice failed for order ${orderId}:`, err);
  }
  try {
    await notifyNewOrder(orderId);
  } catch (err) {
    console.error(`[intake] notification failed for order ${orderId}:`, err);
  }

  return { orderId, orderNumber: order.orderNumber, duplicate: false };
}
