import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toDecimal } from "@/lib/money";
import { pricing } from "@/lib/pricing";
import { computeMachineRates } from "@/lib/machine-cost";

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

// ---------------------------------------------------------------------------
// Product cost calculator (new-product costing)
// ---------------------------------------------------------------------------
//
// The full production cost of a would-be product: machine time + materials +
// design/post-production labour. Same building blocks as the custom quote, plus
// a machine on its own cost/minute (see src/lib/machine-cost.ts):
//
//   machineCost  = machine.costPerMinute × machineMinutes
//   materialCost = Σ(material.unitCost × quantity)
//   labourCost   = hourlyRate × hours
//   totalCost    = machineCost + materialCost + labourCost
//   suggestedPrice = totalCost × (1 + markup/100)   ← a starting point
//
// You keep full control of the final price: pass it in and the calculator
// reports your margin over cost. All figures are excl. VAT.

export interface BuildCostInput {
  machineId?: string | null;
  machineMinutes: number;
  lines: QuoteLineInput[];
  hours: number;
  finalPrice?: number | null;
}

export interface ProductBuildCost {
  machine: {
    id: string;
    name: string;
    costPerHour: string;
    costPerMinute: string; // 4 decimals
  } | null;
  machineMinutes: number;
  machineCost: string;
  materialLines: {
    materialId: string;
    name: string;
    unit: string;
    quantity: string;
    unitCost: string;
    lineCost: string;
  }[];
  materialCost: string;
  hours: number;
  hourlyRate: number;
  labourCost: string;
  totalCost: string;
  markupPercent: number;
  suggestedPrice: string; // totalCost × (1 + markup/100)
  roundedPrice: string; // suggestedPrice rounded to the nearest whole euro
  finalPrice: string | null; // echoed back if you supplied one
  margin: string | null; // finalPrice − totalCost
  marginPercent: string | null; // margin as % of the final (sale) price
}

export async function computeProductBuildCost(
  params: BuildCostInput,
): Promise<ProductBuildCost> {
  // Machine time.
  let machine: ProductBuildCost["machine"] = null;
  let machineCost = toDecimal(0);
  const machineMinutes =
    Number.isFinite(params.machineMinutes) && params.machineMinutes > 0
      ? params.machineMinutes
      : 0;
  if (params.machineId) {
    const m = await prisma.machine.findUnique({
      where: { id: params.machineId },
      select: {
        id: true,
        name: true,
        purchasePrice: true,
        lifetimeHours: true,
        powerKw: true,
        maintenancePerYear: true,
        usageHoursPerYear: true,
      },
    });
    if (m) {
      const rates = computeMachineRates(m);
      machineCost = money(rates.costPerMinute.mul(machineMinutes));
      machine = {
        id: m.id,
        name: m.name,
        costPerHour: money(rates.costPerHour).toFixed(2),
        costPerMinute: rates.costPerMinute.toFixed(4),
      };
    }
  }

  // Materials.
  const validLines = params.lines.filter(
    (l) => l.materialId && Number(l.quantity) > 0,
  );
  const materials = validLines.length
    ? await prisma.material.findMany({
        where: { id: { in: validLines.map((l) => l.materialId) } },
        select: { id: true, name: true, unit: true, unitCost: true },
      })
    : [];
  const byId = new Map(materials.map((m) => [m.id, m]));

  let materialCost = toDecimal(0);
  const materialLines = validLines
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

  // Labour.
  const hours = Number.isFinite(params.hours) && params.hours > 0 ? params.hours : 0;
  const labourCost = money(toDecimal(pricing.hourlyRate).mul(hours));

  // Totals + suggestion.
  const totalCost = money(machineCost.add(materialCost).add(labourCost));
  const suggested = money(
    totalCost.mul(toDecimal(1).add(toDecimal(pricing.markupPercent).div(100))),
  );
  const rounded = suggested.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  // Your final price → margin over cost.
  const hasFinal =
    params.finalPrice != null &&
    Number.isFinite(params.finalPrice) &&
    (params.finalPrice as number) > 0;
  const finalPrice = hasFinal ? money(params.finalPrice as number) : null;
  const margin = finalPrice ? money(finalPrice.sub(totalCost)) : null;
  const marginPercent =
    finalPrice && finalPrice.gt(0)
      ? margin!.div(finalPrice).mul(100).toDecimalPlaces(1).toString()
      : null;

  return {
    machine,
    machineMinutes,
    machineCost: machineCost.toFixed(2),
    materialLines,
    materialCost: money(materialCost).toFixed(2),
    hours,
    hourlyRate: pricing.hourlyRate,
    labourCost: labourCost.toFixed(2),
    totalCost: totalCost.toFixed(2),
    markupPercent: pricing.markupPercent,
    suggestedPrice: suggested.toFixed(2),
    roundedPrice: rounded.toFixed(2),
    finalPrice: finalPrice ? finalPrice.toFixed(2) : null,
    margin: margin ? margin.toFixed(2) : null,
    marginPercent,
  };
}
