import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Offer rules against a mocked Prisma client: saving recomputes prices and
// costing server-side; accepting turns the offer into exactly one order.

const D = (v: string) => new Prisma.Decimal(v);
const db = vi.hoisted(() => ({
  offer: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  offerLine: { deleteMany: vi.fn(), create: vi.fn() },
  machine: { findMany: vi.fn() },
  material: { findMany: vi.fn() },
  quoteRequest: { updateMany: vi.fn(), update: vi.fn() },
  order: { create: vi.fn() },
  orderItem: { create: vi.fn() },
  designAsset: { updateMany: vi.fn() },
  requestEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/server/invoices/createDraftInvoice", () => ({ createDraftInvoice: vi.fn() }));
vi.mock("@/server/counters", () => ({
  nextOrderNumber: vi.fn().mockResolvedValue(42),
  nextOfferNumber: vi.fn().mockResolvedValue("OF-2026-0001"),
}));

import { acceptOffer, saveOffer } from "./offers";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
});

describe("saveOffer", () => {
  it("stores prices incl. VAT and snapshots the costing from current rates", async () => {
    db.offer.findUnique.mockResolvedValue({ status: "DRAFT" });
    db.machine.findMany.mockResolvedValue([
      {
        id: "m1",
        purchasePrice: D("6000"),
        lifetimeHours: D("5000"), // 1.20/h
        powerKw: D("0"),
        maintenancePerYear: D("0"),
        usageHoursPerYear: D("0"),
      },
    ]);
    db.material.findMany.mockResolvedValue([{ id: "mat1", name: "Eik", unitCost: D("8.00") }]);

    await saveOffer("o1", {
      pricesIncludeVat: false,
      validUntil: "2026-10-27",
      intro: null,
      terms: null,
      lines: [
        {
          description: "Naambord",
          quantity: 2,
          price: "50.00", // excl. → 60.50 incl.
          vatRate: "21",
          costing: {
            machineId: "m1",
            machineMinutes: 30, // 0.02/min × 30 = 0.60
            labourHours: 0,
            setupHours: 1, // 45 once → 22.50 per piece
            materials: [{ materialId: "mat1", quantity: 1 }],
          },
        },
        { description: "Levering", quantity: 1, price: "10.00", vatRate: "21", costing: null },
      ],
    });

    const first = db.offerLine.create.mock.calls[0][0].data;
    expect(first.unitPrice.toFixed(2)).toBe("60.50");
    expect(first.lineTotal.toFixed(2)).toBe("121.00");
    expect(first.unitCost.toFixed(2)).toBe("31.10"); // 0.60 + 8.00 + 22.50
    expect(first.setupHours.toString()).toBe("1");
    expect(first.materials.create).toHaveLength(1);

    const second = db.offerLine.create.mock.calls[1][0].data;
    expect(second.unitPrice.toFixed(2)).toBe("12.10");
    expect(second.unitCost).toBeNull();

    const update = db.offer.update.mock.calls[0][0].data;
    expect(update.total).toBe("133.10");
    expect(update.costTotal.toFixed(2)).toBe("62.20");
  });

  it("refuses to edit an offer that was already sent", async () => {
    db.offer.findUnique.mockResolvedValue({ status: "SENT" });
    await expect(
      saveOffer("o1", { pricesIncludeVat: true, validUntil: null, intro: null, terms: null, lines: [] }),
    ).rejects.toThrow(/concept/);
  });
});

describe("acceptOffer", () => {
  const offer = () => ({
    id: "o1",
    offerNumber: "OF-2026-0001",
    status: "SENT",
    total: D("121.00"),
    lines: [
      {
        id: "l1",
        description: "Naambord",
        unitPrice: D("60.50"),
        quantity: 2,
        lineTotal: D("121.00"),
        vatRate: D("21"),
      },
    ],
    request: {
      id: "r1",
      requestNumber: 7,
      status: "OFFER_SENT",
      orderId: null,
      channel: "website",
      customerId: "c1",
      customerRemarks: null,
      description: "Naambord eik",
      deliveryRequested: false,
      deliveryStreet: null,
      deliveryPostal: null,
      deliveryCity: null,
      deliveryCountry: null,
      deliveryNotes: null,
    },
  });

  it("creates a confirmed order linked to the offer lines and closes the request", async () => {
    db.offer.findUnique.mockResolvedValue(offer());
    db.quoteRequest.updateMany.mockResolvedValue({ count: 1 });
    db.order.create.mockResolvedValue({ id: "ord1", orderNumber: 42 });
    db.orderItem.create.mockResolvedValue({ id: "item1" });

    const r = await acceptOffer({ offerId: "o1", userId: "u1" });

    expect(r).toEqual({ orderId: "ord1", orderNumber: 42 });
    const order = db.order.create.mock.calls[0][0].data;
    expect(order.status).toBe("CONFIRMED");
    expect(order.type).toBe("CUSTOM");
    expect(order.total).toBe("121.00");
    expect(order.designBrief).toBe("Naambord eik");
    expect(db.orderItem.create.mock.calls[0][0].data.offerLineId).toBe("l1");
    expect(db.designAsset.updateMany).toHaveBeenCalledWith({
      where: { requestId: "r1", orderItemId: null },
      data: { orderItemId: "item1" },
    });
    expect(db.offer.update.mock.calls[0][0].data.status).toBe("ACCEPTED");
    expect(db.quoteRequest.update.mock.calls[0][0].data.orderId).toBe("ord1");
    expect(createDraftInvoice).toHaveBeenCalledWith("ord1");
  });

  it("never creates a second order for the same request", async () => {
    db.offer.findUnique.mockResolvedValue(offer());
    db.quoteRequest.updateMany.mockResolvedValue({ count: 0 }); // someone else was first
    await expect(acceptOffer({ offerId: "o1", userId: "u1" })).rejects.toThrow(/al omgezet/);
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("refuses an offer without a price", async () => {
    db.offer.findUnique.mockResolvedValue({ ...offer(), total: D("0") });
    await expect(acceptOffer({ offerId: "o1", userId: "u1" })).rejects.toThrow(/prijs/);
  });
});
