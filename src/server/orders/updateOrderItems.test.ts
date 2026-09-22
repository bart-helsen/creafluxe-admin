import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Rules of "Bestelling bewerken", tested against a mocked Prisma client.

const D = (v: string) => new Prisma.Decimal(v);
const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  product: { findMany: vi.fn() },
  invoice: { findUnique: vi.fn() },
  orderItem: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  orderStatusEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/server/invoices/createDraftInvoice", () => ({ createDraftInvoice: vi.fn() }));
vi.mock("@/server/counters", () => ({ nextOrderNumber: vi.fn() }));

import { updateOrderItems } from "./updateOrderItems";

const baseOrder = () => ({
  id: "o1",
  type: "WEBSHOP",
  status: "NEW",
  designBrief: null,
  total: D("28.00"),
  invoice: { status: "DRAFT" },
  items: [
    { id: "i1", nameSnapshot: "Flacon", _count: { customDesigns: 0 } },
    { id: "i2", nameSnapshot: "Naambord", _count: { customDesigns: 2 } },
  ],
});

const item = (p: Record<string, unknown>) => ({
  id: null, productId: null, name: "x", unitPrice: "1.00", quantity: 1, vatRate: "21",
  material: null, size: null, style: null, design: null, remarks: null, ...p,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.order.findUnique.mockResolvedValue(baseOrder());
  db.product.findMany.mockResolvedValue([{ id: "p1", vatRate: D("21") }]);
  db.invoice.findUnique.mockResolvedValue({ status: "DRAFT" });
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
});

describe("updateOrderItems", () => {
  it("updates, adds and logs the old → new total", async () => {
    const r = await updateOrderItems({
      orderId: "o1",
      userId: "u1",
      input: {
        note: "nieuwe prijs",
        items: [
          item({ id: "i1", productId: "p1", name: "Flacon", unitPrice: "16.00", quantity: 2 }),
          item({ id: "i2", name: "Naambord", unitPrice: "10.00" }),
          item({ name: "Korting", unitPrice: "-2.00" }),
        ],
      },
    });
    expect(r).toEqual({ oldTotal: "28.00", newTotal: "40.00" });
    expect(db.orderItem.update).toHaveBeenCalledTimes(2);
    expect(db.orderItem.create).toHaveBeenCalledTimes(1);
    expect(db.orderItem.deleteMany).not.toHaveBeenCalled();
    const event = db.orderStatusEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ fromStatus: "NEW", toStatus: "NEW", changedById: "u1" });
    expect(event.note).toContain("nieuwe prijs");
  });

  it("refuses when the invoice is already issued", async () => {
    db.order.findUnique.mockResolvedValue({ ...baseOrder(), invoice: { status: "ISSUED" } });
    await expect(
      updateOrderItems({ orderId: "o1", userId: "u1", input: { note: null, items: [item({ id: "i1" }), item({ id: "i2" })] } }),
    ).rejects.toThrow(/al uitgereikt/);
  });

  it("refuses to remove a line that has design files", async () => {
    await expect(
      updateOrderItems({ orderId: "o1", userId: "u1", input: { note: null, items: [item({ id: "i1" })] } }),
    ).rejects.toThrow(/ontwerpbestanden/);
  });

  it("removes a line without files", async () => {
    await updateOrderItems({ orderId: "o1", userId: "u1", input: { note: null, items: [item({ id: "i2" })] } });
    expect(db.orderItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["i1"] }, orderId: "o1" } });
  });

  it("rejects a negative total and foreign line ids", async () => {
    await expect(
      updateOrderItems({ orderId: "o1", userId: "u1", input: { note: null, items: [item({ id: "i1" }), item({ id: "i2", unitPrice: "-9" })] } }),
    ).rejects.toThrow(/negatief/);
    await expect(
      updateOrderItems({ orderId: "o1", userId: "u1", input: { note: null, items: [item({ id: "zzz" }), item({ id: "i2" })] } }),
    ).rejects.toThrow(/hoort niet bij/);
  });
});
