// Costing for one offer line — the same building blocks as the product cost
// calculator (machine time + materials + labour, then a markup), plus a one-off
// "setup" time for work you do once per job rather than per piece (designing
// the file, test cuts). Pure arithmetic with no database access, so the offer
// editor can show it live in the browser and the server can recompute exactly
// the same figures when the offer is saved.
//
//   per piece:  machine  = costPerMinute × minutes
//               material = Σ(unitCost × quantity)
//               labour   = hourlyRate × labourHours
//   once:       setup    = hourlyRate × setupHours
//   unitCost   = machine + material + labour + setup / quantity
//   suggested  = unitCost × (1 + markup/100)          (excl. VAT)
//
// All costs are excl. VAT. Figures are rounded to cents only at the end; this
// is a cost estimate, the price you set is what goes on the offer.

export interface OfferCostInput {
  quantity: number;
  machineCostPerMinute: number;
  machineMinutes: number;
  materials: { unitCost: number; quantity: number }[];
  labourHours: number;
  setupHours: number;
  hourlyRate: number;
  markupPercent: number;
  vatRate: number;
}

export interface OfferCostResult {
  machineCost: number; // per piece
  materialCost: number; // per piece
  labourCost: number; // per piece
  setupCost: number; // once, for the whole line
  unitCost: number; // per piece, setup spread over the quantity
  lineCost: number; // unitCost × quantity
  suggestedExcl: number; // per piece
  suggestedIncl: number; // per piece
  roundedExcl: number; // suggestedExcl to whole euros
  roundedIncl: number; // suggestedIncl to whole euros
}

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeOfferLineCost(input: OfferCostInput): OfferCostResult {
  const quantity = Math.max(1, Math.floor(pos(input.quantity)) || 1);
  const machineCost = pos(input.machineCostPerMinute) * pos(input.machineMinutes);
  const materialCost = input.materials.reduce(
    (sum, m) => sum + pos(m.unitCost) * pos(m.quantity),
    0,
  );
  const labourCost = pos(input.hourlyRate) * pos(input.labourHours);
  const setupCost = pos(input.hourlyRate) * pos(input.setupHours);

  const unitCost = machineCost + materialCost + labourCost + setupCost / quantity;
  const vatFactor = 1 + pos(input.vatRate) / 100;
  const suggestedExcl = unitCost * (1 + pos(input.markupPercent) / 100);
  const suggestedIncl = suggestedExcl * vatFactor;

  return {
    machineCost: round2(machineCost),
    materialCost: round2(materialCost),
    labourCost: round2(labourCost),
    setupCost: round2(setupCost),
    unitCost: round2(unitCost),
    lineCost: round2(unitCost * quantity),
    suggestedExcl: round2(suggestedExcl),
    suggestedIncl: round2(suggestedIncl),
    roundedExcl: Math.round(suggestedExcl),
    roundedIncl: Math.round(suggestedIncl),
  };
}

/** Margin of a chosen net (excl. VAT) unit price over the unit cost. */
export function offerMargin(
  unitPriceExcl: number,
  unitCost: number,
): { margin: number; percent: number | null } {
  const margin = round2(unitPriceExcl - unitCost);
  const percent =
    unitPriceExcl > 0 ? Math.round((margin / unitPriceExcl) * 1000) / 10 : null;
  return { margin, percent };
}

/** Net price out of a VAT-inclusive price, rounded to cents. */
export function exclFromIncl(incl: number, vatRate: number): number {
  return round2(incl / (1 + pos(vatRate) / 100));
}

/** VAT-inclusive price from a net price, rounded to cents. */
export function inclFromExcl(excl: number, vatRate: number): number {
  return round2(excl * (1 + pos(vatRate) / 100));
}
