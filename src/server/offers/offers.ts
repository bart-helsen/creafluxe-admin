import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toDecimal, formatEUR } from "@/lib/money";
import { pricing } from "@/lib/pricing";
import { computeMachineRates } from "@/lib/machine-cost";
import { computeOfferLineCost } from "@/lib/offer-cost";
import { defaultOfferIntro, offerDefaults } from "@/lib/company";
import { formatRequestNumber, requestTitle } from "@/lib/requests";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import { nextOfferNumber, nextOrderNumber } from "@/server/counters";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";
import { RequestError } from "@/server/requests/requestEvents";
import type { OfferSaveInput } from "@/lib/validation";

// Offers (Offertes) on a custom request. Lifecycle:
//
//   DRAFT ──save──▶ DRAFT ──mark sent──▶ SENT ──accept──▶ ACCEPTED (+ Order)
//                                         │   └─decline─▶ DECLINED
//                                         └──new version─▶ SUPERSEDED (copy = new DRAFT)
//
// Only a DRAFT can be edited. Prices are stored incl. VAT (like orders and
// invoices); the costing on each line is recomputed server-side from current
// material / machine / labour rates and snapshotted, never trusted from the
// browser.

type Tx = Prisma.TransactionClient;

function addDays(days: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** "2026-10-27" → a Date at noon UTC (stable in Brussels time). */
function parseDateOnly(v: string): Date {
  return new Date(`${v}T12:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Create (new offer, or a new version copied from an existing one)
// ---------------------------------------------------------------------------

export async function createOffer(params: {
  requestId: string;
  userId: string;
  copyFromOfferId?: string | null;
}): Promise<{ offerId: string }> {
  const request = await prisma.quoteRequest.findUnique({
    where: { id: params.requestId },
    include: { customer: true, offers: { select: { version: true } } },
  });
  if (!request) throw new RequestError("Aanvraag niet gevonden.");
  if (request.status === "ACCEPTED" || request.orderId) {
    throw new RequestError("Deze aanvraag is al omgezet in een bestelling.");
  }

  const source = params.copyFromOfferId
    ? await prisma.offer.findUnique({
        where: { id: params.copyFromOfferId },
        include: {
          lines: { orderBy: { sortOrder: "asc" }, include: { materials: true } },
        },
      })
    : null;
  if (params.copyFromOfferId && (!source || source.requestId !== request.id)) {
    throw new RequestError("De offerte om te kopiëren werd niet gevonden.");
  }

  const version = Math.max(0, ...request.offers.map((o) => o.version)) + 1;
  const year = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", year: "numeric" }).format(
      new Date(),
    ),
  );

  const offer = await prisma.$transaction(async (tx) => {
    const offerNumber = await nextOfferNumber(year, tx);
    const created = await tx.offer.create({
      data: {
        offerNumber,
        version,
        status: "DRAFT",
        requestId: request.id,
        validUntil: addDays(offerDefaults.validityDays),
        intro: source ? source.intro : defaultOfferIntro(request.customer.name),
        terms: source ? source.terms : offerDefaults.terms,
        subtotal: source?.subtotal ?? 0,
        vatAmount: source?.vatAmount ?? 0,
        total: source?.total ?? 0,
        costTotal: source?.costTotal ?? null,
      },
    });

    if (source) {
      for (const l of source.lines) {
        await tx.offerLine.create({
          data: {
            offerId: created.id,
            sortOrder: l.sortOrder,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            lineTotal: l.lineTotal,
            machineId: l.machineId,
            machineMinutes: l.machineMinutes,
            labourHours: l.labourHours,
            setupHours: l.setupHours,
            unitCost: l.unitCost,
            markupPercent: l.markupPercent,
            materials: {
              create: l.materials.map((m) => ({
                materialId: m.materialId,
                quantity: m.quantity,
                unitCost: m.unitCost,
              })),
            },
          },
        });
      }
      // You revise an offer because the customer wants changes: the one that
      // was out is replaced by this new version.
      if (source.status === "SENT") {
        await tx.offer.update({
          where: { id: source.id },
          data: { status: "SUPERSEDED" },
        });
      }
    } else {
      await tx.offerLine.create({
        data: {
          offerId: created.id,
          sortOrder: 0,
          description: requestTitle(request),
          quantity: 1,
          unitPrice: 0,
          vatRate: 21,
          lineTotal: 0,
        },
      });
    }

    const note = source
      ? `Offerte ${offerNumber} (versie ${version}) aangemaakt als kopie van ${source.offerNumber}${source.status === "SENT" ? ", die daarmee vervangen is" : ""}`
      : `Offerte ${offerNumber} aangemaakt`;
    const moveToReview = request.status === "NEW";
    await tx.requestEvent.create({
      data: {
        requestId: request.id,
        kind: "OFFER",
        note,
        userId: params.userId,
        ...(moveToReview ? { fromStatus: "NEW", toStatus: "IN_REVIEW" } : {}),
      },
    });
    if (moveToReview) {
      await tx.quoteRequest.update({
        where: { id: request.id },
        data: { status: "IN_REVIEW" },
      });
    }
    return created;
  });

  return { offerId: offer.id };
}

// ---------------------------------------------------------------------------
// Save (edit a draft)
// ---------------------------------------------------------------------------

/** Current cost rates for the machines + materials the lines refer to. */
async function loadRates(input: OfferSaveInput) {
  const machineIds = [
    ...new Set(input.lines.map((l) => l.costing?.machineId).filter((v): v is string => !!v)),
  ];
  const materialIds = [
    ...new Set(
      input.lines.flatMap((l) => (l.costing?.materials ?? []).map((m) => m.materialId)),
    ),
  ];
  const [machines, materials] = await Promise.all([
    machineIds.length
      ? prisma.machine.findMany({ where: { id: { in: machineIds } } })
      : Promise.resolve([]),
    materialIds.length
      ? prisma.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, name: true, unitCost: true },
        })
      : Promise.resolve([]),
  ]);
  const machinePerMinute = new Map(
    machines.map((m) => [m.id, Number(computeMachineRates(m).costPerMinute)]),
  );
  const materialCost = new Map(materials.map((m) => [m.id, m.unitCost]));
  for (const id of machineIds) {
    if (!machinePerMinute.has(id)) throw new RequestError("Een gekozen machine bestaat niet meer.");
  }
  for (const id of materialIds) {
    if (!materialCost.has(id)) throw new RequestError("Een gekozen materiaal bestaat niet meer.");
  }
  return { machinePerMinute, materialCost };
}

/** Build the rows to store for each submitted line (prices + costing snapshot). */
export async function priceOfferLines(input: OfferSaveInput) {
  const rates = await loadRates(input);

  return input.lines.map((l, i) => {
    const vatRate = toDecimal(l.vatRate);
    const entered = money(l.price);
    // Stored incl. VAT; a net price is grossed up once, here.
    const unitPrice = input.pricesIncludeVat
      ? entered
      : money(entered.mul(toDecimal(1).add(vatRate.div(100))));
    const lineTotal = money(unitPrice.mul(l.quantity));

    const c = l.costing;
    const materials = (c?.materials ?? []).filter((m) => m.quantity > 0);
    const hasCosting =
      !!c &&
      ((!!c.machineId && c.machineMinutes > 0) ||
        materials.length > 0 ||
        c.labourHours > 0 ||
        c.setupHours > 0);

    let unitCost: Prisma.Decimal | null = null;
    let lineCost: Prisma.Decimal | null = null;
    if (hasCosting && c) {
      const r = computeOfferLineCost({
        quantity: l.quantity,
        machineCostPerMinute: c.machineId ? rates.machinePerMinute.get(c.machineId) ?? 0 : 0,
        machineMinutes: c.machineId ? c.machineMinutes : 0,
        materials: materials.map((m) => ({
          unitCost: Number(rates.materialCost.get(m.materialId) ?? 0),
          quantity: m.quantity,
        })),
        labourHours: c.labourHours,
        setupHours: c.setupHours,
        hourlyRate: pricing.hourlyRate,
        markupPercent: pricing.markupPercent,
        vatRate: Number(l.vatRate),
      });
      unitCost = money(r.unitCost);
      lineCost = money(r.lineCost);
    }

    return {
      row: {
        sortOrder: i,
        description: l.description,
        quantity: l.quantity,
        unitPrice,
        vatRate,
        lineTotal,
        machineId: hasCosting && c?.machineId && c.machineMinutes > 0 ? c.machineId : null,
        machineMinutes:
          hasCosting && c?.machineId && c.machineMinutes > 0 ? toDecimal(c.machineMinutes) : null,
        labourHours: hasCosting && c && c.labourHours > 0 ? toDecimal(c.labourHours) : null,
        setupHours: hasCosting && c && c.setupHours > 0 ? toDecimal(c.setupHours) : null,
        unitCost,
        markupPercent: hasCosting ? toDecimal(pricing.markupPercent) : null,
      },
      materials: hasCosting
        ? materials.map((m) => ({
            materialId: m.materialId,
            quantity: toDecimal(m.quantity),
            unitCost: toDecimal(rates.materialCost.get(m.materialId) ?? 0),
          }))
        : [],
      lineCost,
    };
  });
}

export async function saveOffer(offerId: string, input: OfferSaveInput): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { status: true },
  });
  if (!offer) throw new RequestError("Offerte niet gevonden.");
  if (offer.status !== "DRAFT") {
    throw new RequestError(
      "Alleen een concept kan aangepast worden. Maak een nieuwe versie om iets te wijzigen.",
    );
  }

  const priced = await priceOfferLines(input);
  const totals = computeInvoiceTotals(
    priced.map((p) => ({
      unitPrice: p.row.unitPrice,
      quantity: p.row.quantity,
      vatRate: p.row.vatRate,
    })),
  );
  if (money(totals.total).isNegative()) {
    throw new RequestError("Het totaal van de offerte kan niet negatief zijn.");
  }
  const costed = priced.filter((p) => p.lineCost);
  const costTotal = costed.length
    ? money(costed.reduce((s, p) => s.add(p.lineCost!), toDecimal(0)))
    : null;

  await prisma.$transaction(async (tx) => {
    // Order items keep a (nullable) link to the line they came from; drafts
    // are never ordered, so replacing the lines is safe.
    await tx.offerLine.deleteMany({ where: { offerId } });
    for (const p of priced) {
      await tx.offerLine.create({
        data: {
          offerId,
          ...p.row,
          materials: { create: p.materials },
        },
      });
    }
    await tx.offer.update({
      where: { id: offerId },
      data: {
        validUntil: input.validUntil ? parseDateOnly(input.validUntil) : null,
        intro: input.intro,
        terms: input.terms,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        costTotal,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Send / decline / delete
// ---------------------------------------------------------------------------

export async function markOfferSent(offerId: string, userId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { request: { select: { id: true, status: true } }, _count: { select: { lines: true } } },
  });
  if (!offer) throw new RequestError("Offerte niet gevonden.");
  if (offer.status !== "DRAFT") throw new RequestError("Deze offerte is al verstuurd.");
  if (offer._count.lines === 0 || !toDecimal(offer.total).gt(0)) {
    throw new RequestError("Vul eerst de prijzen in: het totaal van de offerte is € 0.");
  }
  if (offer.request.status === "ACCEPTED") {
    throw new RequestError("Deze aanvraag is al omgezet in een bestelling.");
  }

  const moveRequest = offer.request.status !== "OFFER_SENT";
  await prisma.$transaction([
    prisma.offer.update({
      where: { id: offerId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        validUntil: offer.validUntil ?? addDays(offerDefaults.validityDays),
      },
    }),
    prisma.requestEvent.create({
      data: {
        requestId: offer.request.id,
        kind: "OFFER",
        note: `Offerte ${offer.offerNumber} verstuurd (${formatEUR(offer.total.toString())} incl. btw)`,
        userId,
        ...(moveRequest ? { fromStatus: offer.request.status, toStatus: "OFFER_SENT" as const } : {}),
      },
    }),
    ...(moveRequest
      ? [
          prisma.quoteRequest.update({
            where: { id: offer.request.id },
            data: { status: "OFFER_SENT" },
          }),
        ]
      : []),
  ]);
}

export async function declineOffer(params: {
  offerId: string;
  userId: string;
  closeRequest: boolean;
  note?: string | null;
}): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: params.offerId },
    include: {
      request: {
        select: { id: true, status: true, offers: { select: { id: true, status: true } } },
      },
    },
  });
  if (!offer) throw new RequestError("Offerte niet gevonden.");
  if (offer.status !== "SENT") {
    throw new RequestError("Alleen een verstuurde offerte kan geweigerd worden.");
  }
  if (offer.request.status === "ACCEPTED") {
    throw new RequestError("Deze aanvraag is al omgezet in een bestelling.");
  }

  // Close the request, or — if no other offer is still out — put it back in
  // review so you can make a better one.
  const otherOut = offer.request.offers.some((o) => o.id !== offer.id && o.status === "SENT");
  const toStatus = params.closeRequest ? "DECLINED" : otherOut ? offer.request.status : "IN_REVIEW";
  const moved = toStatus !== offer.request.status;
  const note = [`Offerte ${offer.offerNumber} geweigerd door de klant`, params.note]
    .filter(Boolean)
    .join(" — ");

  await prisma.$transaction([
    prisma.offer.update({
      where: { id: offer.id },
      data: { status: "DECLINED", decidedAt: new Date() },
    }),
    prisma.requestEvent.create({
      data: {
        requestId: offer.request.id,
        kind: "OFFER",
        note,
        userId: params.userId,
        ...(moved ? { fromStatus: offer.request.status, toStatus } : {}),
      },
    }),
    ...(moved
      ? [prisma.quoteRequest.update({ where: { id: offer.request.id }, data: { status: toStatus } })]
      : []),
  ]);
}

export async function deleteDraftOffer(offerId: string, userId: string): Promise<{ requestId: string }> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) throw new RequestError("Offerte niet gevonden.");
  if (offer.status !== "DRAFT") {
    throw new RequestError("Alleen een concept kan verwijderd worden.");
  }
  await prisma.$transaction([
    prisma.offer.delete({ where: { id: offerId } }),
    prisma.requestEvent.create({
      data: {
        requestId: offer.requestId,
        kind: "OFFER",
        note: `Concept ${offer.offerNumber} verwijderd`,
        userId,
      },
    }),
  ]);
  return { requestId: offer.requestId };
}

// ---------------------------------------------------------------------------
// Accept → a normal order
// ---------------------------------------------------------------------------

/**
 * The customer accepted: create the order (status CONFIRMED) from the offer's
 * lines, move the request's files onto it, mark the offer ACCEPTED and any
 * other open offers SUPERSEDED, close the request, and make the draft invoice.
 * From here on it's handled exactly like any other order.
 */
export async function acceptOffer(params: {
  offerId: string;
  userId: string;
  note?: string | null;
}): Promise<{ orderId: string; orderNumber: number }> {
  const offer = await prisma.offer.findUnique({
    where: { id: params.offerId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      request: true,
    },
  });
  if (!offer) throw new RequestError("Offerte niet gevonden.");
  if (offer.status !== "SENT" && offer.status !== "DRAFT") {
    throw new RequestError("Deze offerte kan niet (meer) aanvaard worden.");
  }
  if (offer.lines.length === 0 || !toDecimal(offer.total).gt(0)) {
    throw new RequestError("Deze offerte heeft nog geen prijs.");
  }
  const request = offer.request;
  if (request.orderId || request.status === "ACCEPTED") {
    throw new RequestError("Deze aanvraag is al omgezet in een bestelling.");
  }

  const totals = computeInvoiceTotals(
    offer.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, vatRate: l.vatRate })),
  );
  const reqNo = formatRequestNumber(request.requestNumber);

  const order = await createOrderFromOffer(offer, request, totals, reqNo, params);

  // Same draft invoice as any order. Best-effort: the order is saved.
  try {
    await createDraftInvoice(order.id);
  } catch (err) {
    console.error(`[offer] draft invoice failed for order ${order.id}:`, err);
  }

  return { orderId: order.id, orderNumber: order.orderNumber };
}

async function createOrderFromOffer(
  offer: Prisma.OfferGetPayload<{ include: { lines: true; request: true } }>,
  request: Prisma.QuoteRequestGetPayload<object>,
  totals: ReturnType<typeof computeInvoiceTotals>,
  reqNo: string,
  params: { userId: string; note?: string | null },
) {
  return prisma.$transaction(async (tx: Tx) => {
    // Claim the request first: a double click (or two tabs) can never create
    // two orders, because only one transaction finds orderId still empty.
    const claimed = await tx.quoteRequest.updateMany({
      where: { id: request.id, orderId: null, status: { not: "ACCEPTED" } },
      data: { status: "ACCEPTED" },
    });
    if (claimed.count === 0) {
      throw new RequestError("Deze aanvraag is al omgezet in een bestelling.");
    }

    const orderNumber = await nextOrderNumber(tx);
    const now = Date.now();
    const order = await tx.order.create({
      data: {
        orderNumber,
        type: "CUSTOM",
        status: "CONFIRMED",
        channel: request.channel,
        customerId: request.customerId,
        customerRemarks: request.customerRemarks,
        designBrief: request.description,
        deliveryRequested: request.deliveryRequested,
        deliveryStreet: request.deliveryStreet,
        deliveryPostal: request.deliveryPostal,
        deliveryCity: request.deliveryCity,
        deliveryCountry: request.deliveryCountry,
        deliveryNotes: request.deliveryNotes,
        subtotal: totals.subtotal,
        total: totals.total,
        statusEvents: {
          create: [
            {
              toStatus: "NEW",
              note: `Aangemaakt uit offerte ${offer.offerNumber} (aanvraag ${reqNo})`,
              changedBy: { connect: { id: params.userId } },
              createdAt: new Date(now),
            },
            {
              fromStatus: "NEW",
              toStatus: "CONFIRMED",
              note: ["Offerte aanvaard door de klant", params.note].filter(Boolean).join(" — "),
              changedBy: { connect: { id: params.userId } },
              createdAt: new Date(now + 1),
            },
          ],
        },
      },
    });

    let firstItemId: string | null = null;
    for (const l of offer.lines) {
      const item = await tx.orderItem.create({
        data: {
          orderId: order.id,
          nameSnapshot: l.description,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
          vatRate: l.vatRate,
          offerLineId: l.id,
        },
      });
      firstItemId ??= item.id;
    }

    // The customer's files follow the job onto the order (first line), so
    // they show up under "Artikelen & ontwerpbestanden" there too.
    if (firstItemId) {
      await tx.designAsset.updateMany({
        where: { requestId: request.id, orderItemId: null },
        data: { orderItemId: firstItemId },
      });
    }

    await tx.offer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", decidedAt: new Date(), orderId: order.id },
    });
    await tx.offer.updateMany({
      where: { requestId: request.id, id: { not: offer.id }, status: { in: ["DRAFT", "SENT"] } },
      data: { status: "SUPERSEDED" },
    });
    await tx.quoteRequest.update({
      where: { id: request.id },
      data: { orderId: order.id },
    });
    await tx.requestEvent.create({
      data: {
        requestId: request.id,
        kind: "OFFER",
        fromStatus: request.status,
        toStatus: "ACCEPTED",
        note: [`Offerte ${offer.offerNumber} aanvaard → bestelling #${orderNumber}`, params.note]
          .filter(Boolean)
          .join(" — "),
        userId: params.userId,
      },
    });

    return order;
  });
}
