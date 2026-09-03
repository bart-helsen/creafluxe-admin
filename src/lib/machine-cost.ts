import { Prisma } from "@prisma/client";
import { toDecimal } from "@/lib/money";
import { pricing } from "@/lib/pricing";

// The single source of truth for "what does a minute on this machine cost?".
// Used by the machine list/detail screens and the product cost calculator so
// the number is always computed the same way (docs: Machine model).
//
//   depreciation/hour = purchasePrice / lifetimeHours
//   energy/hour       = powerKw × electricityPrice (€/kWh, from pricing settings)
//   maintenance/hour  = maintenancePerYear / usageHoursPerYear
//   cost/hour         = the three added together
//   cost/minute       = cost/hour ÷ 60
//
// Every figure is EUR excl. VAT. Divisions guard against zero so a half-filled
// machine never throws — a missing lifetime simply means €0 depreciation.

export interface MachineCostInput {
  purchasePrice: Prisma.Decimal | string | number;
  lifetimeHours: Prisma.Decimal | string | number;
  powerKw: Prisma.Decimal | string | number;
  maintenancePerYear: Prisma.Decimal | string | number;
  usageHoursPerYear: Prisma.Decimal | string | number;
}

export interface MachineRates {
  depreciationPerHour: Prisma.Decimal;
  energyPerHour: Prisma.Decimal;
  maintenancePerHour: Prisma.Decimal;
  costPerHour: Prisma.Decimal;
  costPerMinute: Prisma.Decimal;
  /** The electricity price (€/kWh) used, so the UI can show what fed the sum. */
  electricityPrice: number;
}

export function computeMachineRates(m: MachineCostInput): MachineRates {
  const purchasePrice = toDecimal(m.purchasePrice);
  const lifetimeHours = toDecimal(m.lifetimeHours);
  const powerKw = toDecimal(m.powerKw);
  const maintenancePerYear = toDecimal(m.maintenancePerYear);
  const usageHoursPerYear = toDecimal(m.usageHoursPerYear);
  const electricityPrice = toDecimal(pricing.electricityPrice);

  const depreciationPerHour = lifetimeHours.gt(0)
    ? purchasePrice.div(lifetimeHours)
    : toDecimal(0);
  const energyPerHour = powerKw.mul(electricityPrice);
  const maintenancePerHour = usageHoursPerYear.gt(0)
    ? maintenancePerYear.div(usageHoursPerYear)
    : toDecimal(0);

  const costPerHour = depreciationPerHour
    .add(energyPerHour)
    .add(maintenancePerHour);
  const costPerMinute = costPerHour.div(60);

  return {
    depreciationPerHour,
    energyPerHour,
    maintenancePerHour,
    costPerHour,
    costPerMinute,
    electricityPrice: pricing.electricityPrice,
  };
}

/** Format a €/minute rate with 4 decimals, e.g. "€ 0,0263". */
export function formatPerMinute(value: Prisma.Decimal | string | number): string {
  const n = Number(value.toString());
  return `€ ${n.toLocaleString("nl-BE", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
}
