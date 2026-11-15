import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Removing / cancelling an invoice independently of its order, tested against
// a mocked Prisma client.

const D = (v: string) => new Prisma.Decimal(v);
const db = vi.hoisted(() => ({
  invoice: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  creditNote: { create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));
const nextCreditNoteNumber = vi.hoisted(() => vi.fn());
vi.mock("@/server/counters", () => ({ nextCreditNoteNumber }));

import { cancelInvoiceWithCreditNote } from "./cancelInvoice";
import { deleteDraftInvoice } from "./deleteDraftInvoice";

const issued = (p: Record<string, unknown> = {}) => ({
  id: "inv1",
  invoiceNumber: "2026-0007",
  status: "ISSUED",
  orderId: "o1",
  customerId: "c1",
  currency: "EUR",
  creditNote: null,
  lines: [
    { description: "Naambord", quantity: 2, unitPrice: D("12.10"), vatRate: D("21"), lineTotal: D("24.20") },
  ],
  ...p,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  nextCreditNoteNumber.mockResolvedValue("2026-0001");
  db.creditNote.create.mockResolvedValue({ id: "cn1" });
});

describe("cancelInvoiceWithCreditNote", () => {
  it("creates a full credit note with its own number and cancels the invoice", async () => {
    db.invoice.findUnique.mockResolvedValue(issued());
    const r = await cancelInvoiceWithCreditNote({ invoiceId: "inv1", reason: "verkeerde prijs" });

    expect(r).toEqual({ creditNoteId: "cn1", creditNoteNumber: "2026-0001", orderId: "o1" });
    const data = db.creditNote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      creditNoteNumber: "2026-0001",
      invoiceId: "inv1",
      customerId: "c1",
      reason: "verkeerde prijs",
      subtotal: "20.00",
      vatAmount: "4.20",
      total: "24.20",
    });
    expect(data.lines.createMany.data).toHaveLength(1);
    expect(db.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { status: "CANCELLED" },
    });
  });

  it("can credit a paid invoice and an old-style cancelled one", async () => {
    db.invoice.findUnique.mockResolvedValue(issued({ status: "PAID" }));
    await expect(cancelInvoiceWithCreditNote({ invoiceId: "inv1", reason: null })).resolves.toBeDefined();
    db.invoice.findUnique.mockResolvedValue(issued({ status: "CANCELLED" }));
    await expect(cancelInvoiceWithCreditNote({ invoiceId: "inv1", reason: null })).resolves.toBeDefined();
  });

  it("refuses a draft and an invoice that already has a credit note", async () => {
    db.invoice.findUnique.mockResolvedValue(issued({ status: "DRAFT", invoiceNumber: null }));
    await expect(cancelInvoiceWithCreditNote({ invoiceId: "inv1", reason: null })).rejects.toThrow(/concept/);
    db.invoice.findUnique.mockResolvedValue(issued({ status: "CANCELLED", creditNote: { id: "x" } }));
    await expect(cancelInvoiceWithCreditNote({ invoiceId: "inv1", reason: null })).rejects.toThrow(/al een creditnota/);
    expect(nextCreditNoteNumber).not.toHaveBeenCalled();
  });
});

describe("deleteDraftInvoice", () => {
  it("deletes a draft and returns its order", async () => {
    db.invoice.findUnique.mockResolvedValue({ id: "inv1", status: "DRAFT", invoiceNumber: null, orderId: "o1", pdfStorageKey: null });
    await expect(deleteDraftInvoice("inv1")).resolves.toEqual({ orderId: "o1" });
    expect(db.invoice.delete).toHaveBeenCalledWith({ where: { id: "inv1" } });
  });

  it("never deletes an issued invoice", async () => {
    db.invoice.findUnique.mockResolvedValue({ id: "inv1", status: "ISSUED", invoiceNumber: "2026-0007", orderId: "o1", pdfStorageKey: null });
    await expect(deleteDraftInvoice("inv1")).rejects.toThrow(/creditnota/);
    expect(db.invoice.delete).not.toHaveBeenCalled();
  });
});
