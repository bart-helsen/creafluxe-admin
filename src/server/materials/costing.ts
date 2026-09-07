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
  /** VAT rate (%) used to derive the incl.-VAT figures. Defaults to 21. */
  vatRate?: number | null;
  /**
   * How to read `finalPrice`: false/undefined = you typed an amount EXCL. VAT
   * (B2B — a round net price); true = you typed an amount INCL. VAT (B2C — a
   * round shelf price). Only affects how finalPrice is split into excl/incl; the
   * margin is always taken on the net (excl.-VAT) amount, since VAT isn't yours.
   */
  finalPriceInclVat?: boolean;
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
  vatRate: number; // the VAT rate (%) used for the incl.-VAT figures
  suggestedPrice: string; // totalCost × (1 + markup/100), excl. VAT
  suggestedPriceIncl: string; // suggestedPrice × (1 + vat/100)
  roundedPrice: string; // suggestedPrice rounded to the nearest whole euro (excl.)
  roundedPriceIncl: string; // suggestedPriceIncl rounded to the nearest whole euro
  finalPrice: string | null; // your final price, EXCL. VAT (derived from the mode)
  finalPriceIncl: string | null; // your final price, INCL. VAT
  margin: string | null; // finalPrice(excl) − totalCost
  marginPercent: string | null; // margin as % of the final net (excl.) price
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

  // VAT factor for the incl.-VAT figures (default 21%).
  const vatRate =
    params.vatRate != null &&
    Number.isFinite(params.vatRate) &&
    (params.vatRate as number) >= 0
      ? (params.vatRate as number)
      : 21;
  const vatFactor = toDecimal(1).add(toDecimal(vatRate).div(100));

  // Totals + suggestion (excl. VAT), plus the incl.-VAT mirror of each.
  const totalCost = money(machineCost.add(materialCost).add(labourCost));
  const suggested = money(
    totalCost.mul(toDecimal(1).add(toDecimal(pricing.markupPercent).div(100))),
  );
  const suggestedIncl = money(suggested.mul(vatFactor));
  // Round each side to whole euros independently: an excl. price rounds to a neat
  // net number (B2B), an incl. price rounds to a neat shelf number (B2C).
  const rounded = suggested.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const roundedIncl = suggestedIncl.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  // Your final price → split into excl/incl per the chosen mode, then margin.
  const hasFinal =
    params.finalPrice != null &&
    Number.isFinite(params.finalPrice) &&
    (params.finalPrice as number) > 0;
  let finalExcl: Prisma.Decimal | null = null;
  let finalIncl: Prisma.Decimal | null = null;
  if (hasFinal) {
    const raw = money(params.finalPrice as number);
    if (params.finalPriceInclVat === true) {
      finalIncl = raw;
      finalExcl = money(raw.div(vatFactor));
    } else {
      finalExcl = raw;
      finalIncl = money(raw.mul(vatFactor));
    }
  }
  // Margin is always on the net (excl.-VAT) amount — the VAT isn't your money.
  const margin = finalExcl ? money(finalExcl.sub(totalCost)) : null;
  const marginPercent =
    finalExcl && finalExcl.gt(0)
      ? margin!.div(finalExcl).mul(100).toDecimalPlaces(1).toString()
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
    vatRate,
    suggestedPrice: suggested.toFixed(2),
    suggestedPriceIncl: suggestedIncl.toFixed(2),
    roundedPrice: rounded.toFixed(2),
    roundedPriceIncl: roundedIncl.toFixed(2),
    finalPrice: finalExcl ? finalExcl.toFixed(2) : null,
    finalPriceIncl: finalIncl ? finalIncl.toFixed(2) : null,
    margin: margin ? margin.toFixed(2) : null,
    marginPercent,
  };
}

// ---------------------------------------------------------------------------
// Stored costing for a catalogue product (promoted from the calculator)
// ---------------------------------------------------------------------------
//
// A product promoted from the cost calculator carries a ProductCosting row
// (machine + minutes + labour hours) and a bill of materials (ProductMaterial).
// This rebuilds the full production-cost breakdown from those stored inputs,
// recomputed against *current* material/machine/labour rates — so the product
// page always shows today's cost, not a frozen number. Returns null when the
// product has neither a costing row nor any BOM lines.

export interface StoredProductBuildCost extends ProductBuildCost {
  /** The promotion snapshot (excl. VAT), if one was saved. */
  snapshot: {
    costAtPromotion: string | null;
    priceAtPromotion: string | null;
    markupPercent: string | null;
    promotedAt: Date;
  } | null;
}

export async function computeStoredProductBuildCost(
  productId: string,
  vatRate?: number | null,
): Promise<StoredProductBuildCost | null> {
  const [costing, bom] = await Promise.all([
    prisma.productCosting.findUnique({ where: { productId } }),
    prisma.productMaterial.findMany({
      where: { productId },
      select: { materialId: true, quantity: true },
    }),
  ]);

  if (!costing && bom.length === 0) return null;

  const build = await computeProductBuildCost({
    machineId: costing?.machineId ?? null,
    machineMinutes: costing?.machineMinutes ? Number(costing.machineMinutes) : 0,
    lines: bom.map((b) => ({ materialId: b.materialId, quantity: b.quantity })),
    hours: costing?.labourHours ? Number(costing.labourHours) : 0,
    finalPrice: null,
    vatRate: vatRate ?? undefined,
  });

  return {
    ...build,
    snapshot: costing
      ? {
          costAtPromotion: costing.costAtPromotion?.toFixed(2) ?? null,
          priceAtPromotion: costing.priceAtPromotion?.toFixed(2) ?? null,
          markupPercent: costing.markupPercent?.toString() ?? null,
          promotedAt: costing.createdAt,
        }
      : null,
  };
}
