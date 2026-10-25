import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), NOTIFY_EMAIL: "x@example.be" }));
vi.mock("@/server/materials/stock", () => ({ recordStockMovement: vi.fn() }));
vi.mock("@/server/purchases/extract", () => ({ extractFromFile: vi.fn(), extractionJson: vi.fn() }));

import { canTransition, purchaseConfirmMissing } from "./purchaseInvoices";
import { pickReminders } from "./notifyStale";

describe("canTransition", () => {
  it("allows the forward flow and stepping back one step", () => {
    expect(canTransition("RECEIVED", "CHECKED")).toBe(true);
    expect(canTransition("CHECKED", "UPLOADED_TO_DEXXTER")).toBe(true);
    expect(canTransition("CHECKED", "RECEIVED")).toBe(true);
    expect(canTransition("UPLOADED_TO_DEXXTER", "CHECKED")).toBe(true);
  });

  it("never skips the review step", () => {
    expect(canTransition("RECEIVED", "UPLOADED_TO_DEXXTER")).toBe(false);
    expect(canTransition("UPLOADED_TO_DEXXTER", "RECEIVED")).toBe(false);
  });
});

describe("purchaseConfirmMissing", () => {
  it("lists what's still needed to confirm", () => {
    expect(purchaseConfirmMissing({ supplierName: "Acme", grossAmount: "10.00" })).toEqual([
      "factuurnummer",
      "factuurdatum",
      "nettobedrag",
    ]);
    expect(
      purchaseConfirmMissing({
        supplierName: "Acme",
        invoiceNumber: "1",
        invoiceDate: "2026-01-01",
        netAmount: "10.00",
        grossAmount: "10.00",
      }),
    ).toEqual([]);
  });
});

describe("pickReminders", () => {
  const now = new Date("2026-10-24T08:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

  it("only counts invoices stuck for more than 7 days", () => {
    const { stale, due } = pickReminders(
      [
        { id: "a", status: "RECEIVED", statusChangedAt: daysAgo(8), lastRemindedAt: null },
        { id: "b", status: "CHECKED", statusChangedAt: daysAgo(6), lastRemindedAt: null },
        { id: "c", status: "UPLOADED_TO_DEXXTER", statusChangedAt: daysAgo(30), lastRemindedAt: null },
      ],
      now,
    );
    expect(stale.map((i) => i.id)).toEqual(["a"]);
    expect(due).toBe(true);
  });

  it("does not nag again within the reminder interval", () => {
    const recent = pickReminders(
      [{ id: "a", status: "CHECKED", statusChangedAt: daysAgo(10), lastRemindedAt: daysAgo(1) }],
      now,
    );
    expect(recent).toMatchObject({ due: false });
    const later = pickReminders(
      [{ id: "a", status: "CHECKED", statusChangedAt: daysAgo(10), lastRemindedAt: daysAgo(3) }],
      now,
    );
    expect(later.due).toBe(true);
  });

  it("still reminds on a Thursday → Sunday schedule when the run starts a bit early", () => {
    const thursday = new Date("2026-10-22T07:00:30Z");
    const sunday = new Date("2026-10-25T07:00:05Z"); // 25 s short of 3 days
    const r = pickReminders(
      [{ id: "a", status: "CHECKED", statusChangedAt: daysAgo(10), lastRemindedAt: thursday }],
      sunday,
    );
    expect(r.due).toBe(true);
  });
});
