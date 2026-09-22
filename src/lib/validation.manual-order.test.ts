import { describe, expect, it } from "vitest";
import { manualOrderSchema } from "./validation";

const base = {
  customer: { mode: "existing", id: "cust_1" },
  type: "WEBSHOP",
  channel: "telefoon",
  initialStatus: "NEW",
  items: [
    { productId: "prod_1", name: "Heup flacon", unitPrice: "12,50", quantity: "2", vatRate: "21" },
  ],
  delivery: { requested: false },
};

describe("manualOrderSchema", () => {
  it("accepts a simple order and normalises a comma price", () => {
    const r = manualOrderSchema.parse(base);
    expect(r.items[0].unitPrice).toBe("12.50");
    expect(r.items[0].quantity).toBe(2);
    expect(r.customer).toEqual({ mode: "existing", id: "cust_1" });
  });

  it("allows a negative discount line", () => {
    const r = manualOrderSchema.parse({
      ...base,
      items: [...base.items, { name: "Korting", unitPrice: "-5", quantity: 1, vatRate: "21" }],
    });
    expect(r.items[1].unitPrice).toBe("-5");
    expect(r.items[1].productId).toBeNull();
  });

  it("requires a customer when mode is existing", () => {
    const r = manualOrderSchema.safeParse({ ...base, customer: { mode: "existing", id: "" } });
    expect(r.success).toBe(false);
  });

  it("accepts a new phone-only customer", () => {
    const r = manualOrderSchema.parse({
      ...base,
      customer: { mode: "new", name: "Jan Peeters", email: "", phone: "0470 12 34 56" },
    });
    expect(r.customer.mode).toBe("new");
    if (r.customer.mode === "new") expect(r.customer.email).toBeNull();
  });

  it("rejects a new customer without e-mail or phone", () => {
    const r = manualOrderSchema.safeParse({
      ...base,
      customer: { mode: "new", name: "Jan", email: "", phone: "" },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/e-mailadres of telefoonnummer/);
  });

  it("rejects an order without items unless it is custom work with a brief", () => {
    expect(manualOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(
      manualOrderSchema.safeParse({
        ...base,
        items: [],
        type: "CUSTOM",
        designBrief: "Naambord in eik, 40 cm",
      }).success,
    ).toBe(true);
  });

  it("needs a street and city for delivery", () => {
    const r = manualOrderSchema.safeParse({
      ...base,
      delivery: { requested: true, street: "Langestraat 13", city: "" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown channels and production start statuses", () => {
    expect(manualOrderSchema.safeParse({ ...base, channel: "fax" }).success).toBe(false);
    expect(
      manualOrderSchema.safeParse({ ...base, initialStatus: "IN_PRODUCTION" }).success,
    ).toBe(false);
  });
});
