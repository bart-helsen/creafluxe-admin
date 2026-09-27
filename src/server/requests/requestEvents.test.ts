import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/server/orders/createOrder", () => ({ assetFromKey: vi.fn() }));

import { statusAfterEvent } from "./requestEvents";
import { intakeDescription } from "./createRequest";

vi.mock("@/server/notifications/notifyNewRequest", () => ({ notifyNewRequest: vi.fn() }));

describe("statusAfterEvent", () => {
  it("a question puts the request on 'waiting for customer'", () => {
    expect(statusAfterEvent("NEW", "QUESTION")).toBe("WAITING_CUSTOMER");
    expect(statusAfterEvent("IN_REVIEW", "QUESTION")).toBe("WAITING_CUSTOMER");
  });

  it("an answer brings it back in review", () => {
    expect(statusAfterEvent("WAITING_CUSTOMER", "ANSWER")).toBe("IN_REVIEW");
  });

  it("notes, and anything while an offer is out, leave the status alone", () => {
    expect(statusAfterEvent("NEW", "NOTE")).toBe("NEW");
    expect(statusAfterEvent("OFFER_SENT", "QUESTION")).toBe("OFFER_SENT");
    expect(statusAfterEvent("OFFER_SENT", "ANSWER")).toBe("OFFER_SENT");
    expect(statusAfterEvent("DECLINED", "ANSWER")).toBe("DECLINED");
  });
});

describe("intakeDescription", () => {
  const base = {
    type: "CUSTOM" as const,
    customer: { name: "Jan", email: "jan@example.be", isBusiness: false },
    items: [],
  };

  it("uses the Atelier brief as-is", () => {
    expect(intakeDescription({ ...base, designBrief: "Naambord eik" })).toBe("Naambord eik");
  });

  it("keeps any lines that were sent along", () => {
    const d = intakeDescription({
      ...base,
      designBrief: "Zie hieronder",
      items: [
        {
          name: "Onderzetter",
          quantity: 4,
          unitPrice: "3.00",
          material: "Linde",
          remarks: "met initialen",
          uploadKeys: [],
        },
      ],
    });
    expect(d).toContain("Zie hieronder");
    expect(d).toContain("• 4 × Onderzetter (Linde) — met initialen");
  });
});
