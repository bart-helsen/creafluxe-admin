import { describe, expect, it } from "vitest";
import {
  emptyLine,
  linesToPayload,
  refreshFromCatalogue,
  type Line,
  type PickerProduct,
} from "./OrderLinesEditor";
import { orderItemsUpdateSchema } from "@/lib/validation";

const flacon: PickerProduct = {
  id: "p1",
  sku: "HEUP-LEER",
  name: "Heup flacon (leer)",
  basePrice: "15.00", // was 14.00 when the order was made
  vatRate: "21",
  active: true,
  options: [{ type: "DESIGN", value: "Leeuw", priceDelta: "1.50" }],
};
const byId = new Map([[flacon.id, flacon]]);

const line = (patch: Partial<Line>): Line => ({ ...emptyLine(1), ...patch });

describe("refreshFromCatalogue", () => {
  it("re-prices catalogue lines incl. option deltas and leaves free lines alone", () => {
    const lines = [
      line({ key: 1, id: "i1", productId: "p1", name: "Flacon", unitPrice: "15,50", design: "Leeuw" }),
      line({ key: 2, id: "i2", name: "Korting", unitPrice: "-5,00" }),
    ];
    const r = refreshFromCatalogue(lines, byId);
    expect(r.changed).toBe(1);
    expect(r.lines[0].unitPrice).toBe("16,50");
    expect(r.lines[1].unitPrice).toBe("-5,00");
  });

  it("reports nothing changed when prices already match", () => {
    const r = refreshFromCatalogue([line({ productId: "p1", unitPrice: "15,00" })], byId);
    expect(r.changed).toBe(0);
  });
});

describe("edit payload", () => {
  it("round-trips through the update schema, keeping existing ids", () => {
    const payload = {
      items: linesToPayload([
        line({ key: 1, id: "i1", productId: "p1", name: "Flacon", unitPrice: "16,50", quantity: "2" }),
        line({ key: 2, name: "Extra graveerwerk", unitPrice: "7", vatRate: "21" }),
        line({ key: 3 }), // empty row is dropped
      ]),
      note: "nieuwe catalogusprijs",
    };
    const r = orderItemsUpdateSchema.parse(payload);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ id: "i1", unitPrice: "16.50", quantity: 2 });
    expect(r.items[1].id).toBeNull();
  });
});
