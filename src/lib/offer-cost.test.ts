import { describe, expect, it } from "vitest";
import { computeOfferLineCost, exclFromIncl, inclFromExcl, offerMargin } from "./offer-cost";

// Offer-line costing: the same sum the editor shows live and the server stores.

const base = {
  quantity: 1,
  machineCostPerMinute: 0,
  machineMinutes: 0,
  materials: [],
  labourHours: 0,
  setupHours: 0,
  hourlyRate: 45,
  markupPercent: 60,
  vatRate: 21,
};

describe("computeOfferLineCost", () => {
  it("adds machine, material and labour per piece and applies the markup", () => {
    const r = computeOfferLineCost({
      ...base,
      machineCostPerMinute: 0.05,
      machineMinutes: 12, // 0.60
      materials: [
        { unitCost: 4.5, quantity: 1 }, // 4.50
        { unitCost: 0.2, quantity: 2.5 }, // 0.50
      ],
      labourHours: 0.5, // 22.50
    });
    expect(r.machineCost).toBe(0.6);
    expect(r.materialCost).toBe(5);
    expect(r.labourCost).toBe(22.5);
    expect(r.unitCost).toBe(28.1);
    expect(r.suggestedExcl).toBe(44.96); // 28.10 × 1.6
    expect(r.suggestedIncl).toBe(54.4); // 44.96 × 1.21 = 54.4016
    expect(r.roundedExcl).toBe(45);
    expect(r.roundedIncl).toBe(54);
  });

  it("spreads one-off setup hours over the quantity", () => {
    const r = computeOfferLineCost({
      ...base,
      quantity: 20,
      materials: [{ unitCost: 1, quantity: 1 }],
      setupHours: 2, // 90 once → 4.50 per piece
    });
    expect(r.setupCost).toBe(90);
    expect(r.unitCost).toBe(5.5);
    expect(r.lineCost).toBe(110);
  });

  it("ignores negative / missing inputs instead of producing nonsense", () => {
    const r = computeOfferLineCost({
      ...base,
      quantity: 0,
      machineMinutes: -5,
      machineCostPerMinute: 1,
      materials: [{ unitCost: 2, quantity: Number.NaN }],
      labourHours: -1,
    });
    expect(r.unitCost).toBe(0);
    expect(r.lineCost).toBe(0);
  });
});

describe("VAT helpers + margin", () => {
  it("round-trips a net price through incl. VAT", () => {
    for (const net of [99.99, 12.5, 0.01, 1234.56]) {
      for (const vat of [21, 12, 6]) {
        expect(exclFromIncl(inclFromExcl(net, vat), vat)).toBe(net);
      }
    }
  });

  it("reports margin on the net price", () => {
    expect(offerMargin(50, 30)).toEqual({ margin: 20, percent: 40 });
    expect(offerMargin(20, 25)).toEqual({ margin: -5, percent: -25 });
    expect(offerMargin(0, 5).percent).toBeNull();
  });
});
