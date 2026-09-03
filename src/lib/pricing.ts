// Pricing settings used by the costing helpers (docs/11). Kept in env so the
// price suggestion is consistent across the app and easy to change without a
// deploy of code. All excl. VAT — costing is a net-cost calculation.
//
//   markupPercent    — markup applied to material cost to suggest a sale price
//                      (e.g. 60 → cost × 1.60).
//   hourlyRate       — your labour rate per hour, added to custom quotes and to
//                      the product cost calculator (design + post-production).
//   electricityPrice — price you pay per kWh; combined with each machine's power
//                      draw to work out its energy cost per hour. One place to
//                      change it and every machine's cost/minute updates.
//
// Fill these on Railway (and .env) with your real values.

export const pricing = {
  /** Markup on material cost when suggesting a catalogue sale price (percent). */
  markupPercent: Number(process.env.PRICING_MARKUP_PERCENT ?? "60"),
  /** Labour rate per hour (EUR, excl. VAT) used in the calculators. */
  hourlyRate: Number(process.env.PRICING_HOURLY_RATE ?? "45"),
  /** Electricity price (EUR per kWh, excl. VAT) used for machine energy cost. */
  electricityPrice: Number(process.env.PRICING_ELECTRICITY_PRICE ?? "0.35"),
};
