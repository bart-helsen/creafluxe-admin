import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toDecimal } from "@/lib/money";
import { pricing } from "@/lib/pricing";

// Material-based costing (docs/11). Two payoffs:
//   1. Catalogue product: from its bill of materials, compute live material cost
//      and suggest a sale price (cost × markup).
//   2. Custom one-off: add material cost + labour (hourlyRate × hours) + markup.
// All figures are excl. VAT — this is a cost/margin calculation, not an invoice.

export interface ProductCost {
  materialCost: string; // Σ(unitCost × bom quantity), 2 decimals
  lines: {
    materialId: string;
    name: string;
    unit: string;
    quantity: string; // per single product
    unitCost: string;
    lineCost: string;
  }[];
  suggestedPrice: string; // materialCost × (1 + markup/100)
  markupPercent: number;
}

/** Compute the material cost and a suggested price for a catalogue product. */
export async function computeProductCost(productId: string): Promise<ProductCost> {
  const bom = await prisma.productMaterial.findMany({
    where: { productId },
    include: { material: true },
  });

  let materialCost = toDecimal(0);
  const lines = bom.map((b) => {
    const qty = toDecimal(b.quantity);
    const unitCost = toDecimal(b.material.unitCost);
    const lineCost = money(unitCost.mul(qty));
    materialCost = materialCost.add(lineCost);
    return {
      materialId: b.materialId,
      name: b.material.name,
      unit: b.material.unit,
      quantity: qty.toString(),
      unitCost: unitCost.toFixed(4),
      lineCost: lineCost.toFixed(2),
    };
  });

  const suggested = money(
    materialCost.mul(toDecimal(1).add(toDecimal(pricing.markupPercent).div(100))),
  );

  return {
    materialCost: money(materialCost).toFixed(2),
    lines,
    suggestedPrice: suggested.toFixed(2),
    markupPercent: pricing.markupPercent,
  };
}

export interface QuoteLineInput {
  materialId: string;
  quantity: Prisma.Decimal | string | number;
}

export interface CustomQuote {
  materialCost: string;
  labourCost: string;
  hours: number;
  hourlyRate: number;
  markupPercent: number;
  subtotal: string; // material + labour
  suggestedPrice: string; // subtotal × (1 + markup/100)
  lines: {
    materialId: string;
    name: string;
    unit: string;
    quantity: string;
    unitCost: string;
    lineCost: string;
  }[];
}

/**
 * Cost a custom one-off: chosen materials + rough quantities plus estimated
 * hours. Material cost comes from each material's current unitCost; labour is
 * hours × your hourly rate; markup is applied to the sum. You still decide the
 * final figure — this just starts you from real, current costs.
 */
export async function computeCustomQuote(params: {
  lines: QuoteLineInput[];
  hours: number;
}): Promise<CustomQuote> {
  const materials = await prisma.material.findMany({
    where: { id: { in: params.lines.map((l) => l.materialId) } },
    select: { id: true, name: true, unit: true, unitCost: true },
  });
  const byId = new Map(materials.map((m) => [m.id, m]));

  let materialCost = toDecimal(0);
  const lines = params.lines
    .map((l) => {
      const m = byId.get(l.materialId);
      if (!m) return null;
      const qty = toDecimal(l.quantity);
      const unitCost = toDecimal(m.unitCost);
      const lineCost = money(unitCost.mul(qty));
      materialCost = materialCost.add(lineCost);
      return {
        materialId: m.id,
        name: m.name,
        unit: m.unit,
        quantity: qty.toString(),
        unitCost: unitCost.toFixed(4),
        lineCost: lineCost.toFixed(2),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const hours = Number.isFinite(params.hours) && params.hours > 0 ? params.hours : 0;
  const labourCost = money(toDecimal(pricing.hourlyRate).mul(hours));
  const subtotal = money(materialCost.add(labourCost));
  const suggested = money(
    subtotal.mul(toDecimal(1).add(toDecimal(pricing.markupPercent).div(100))),
  );

  return {
    materialCost: money(materialCost).toFixed(2),
    labourCost: labourCost.toFixed(2),
    hours,
    hourlyRate: pricing.hourlyRate,
    markupPercent: pricing.markupPercent,
    subtotal: subtotal.toFixed(2),
    suggestedPrice: suggested.toFixed(2),
    lines,
  };
}
