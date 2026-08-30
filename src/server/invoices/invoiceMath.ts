import { Prisma } from "@prisma/client";
import { money, toDecimal } from "@/lib/money";

// Pure invoice arithmetic — no database, no framework, so it is trivial to
// unit-test (see src/server/invoices/invoiceMath.test.ts). Gapless numbering and
// this math are the two places a bug is expensive, so they live on their own.
//
// VAT MODEL — IMPORTANT (verify with your accountant):
//   Catalogue/cart prices are treated as **VAT-INCLUSIVE** consumer (gross)
//   prices, which is the norm for a Belgian B2C webshop: the customer is shown
//   and pays €12,00 including 21% VAT. The invoice therefore derives the net
//   base and the VAT amount *out of* the gross, per VAT rate, so:
//       subtotal (net) + vatAmount == total (gross) exactly, and
//       total == what the customer saw in the cart.
//   Flip PRICES_INCLUDE_VAT to false if you ever price net (excl. VAT) instead.

export const PRICES_INCLUDE_VAT = true;

export interface LineInput {
  unitPrice: Prisma.Decimal | string | number; // gross if PRICES_INCLUDE_VAT
  quantity: number;
  vatRate: Prisma.Decimal | string | number; // percent, e.g. 21
}

export interface VatBucket {
  vatRate: string; // "21.00"
  base: string; // net base for this rate
  vat: string; // VAT amount for this rate
}

export interface InvoiceTotals {
  subtotal: string; // net, 2 decimals
  vatAmount: string; // 2 decimals
  total: string; // gross, 2 decimals
  lineTotals: string[]; // gross line total per input line (same order)
  vatByRate: VatBucket[];
}

/**
 * Compute authoritative invoice totals from line inputs. VAT is computed per
 * rate on the summed base (the standard method) so rounding happens once per
 * rate, and subtotal + vatAmount always equals total.
 */
export function computeInvoiceTotals(lines: LineInput[]): InvoiceTotals {
  const lineTotals: string[] = [];
  const grossByRate = new Map<string, Prisma.Decimal>();

  for (const line of lines) {
    const rate = toDecimal(line.vatRate);
    const rateKey = rate.toFixed(2);
    const gross = money(toDecimal(line.unitPrice).mul(line.quantity));
    lineTotals.push(gross.toFixed(2));
    grossByRate.set(
      rateKey,
      (grossByRate.get(rateKey) ?? toDecimal(0)).add(gross),
    );
  }

  let subtotal = toDecimal(0);
  let vatAmount = toDecimal(0);
  let total = toDecimal(0);
  const vatByRate: VatBucket[] = [];

  // Deterministic order: ascending VAT rate.
  const rateKeys = [...grossByRate.keys()].sort(
    (a, b) => Number(a) - Number(b),
  );

  for (const rateKey of rateKeys) {
    const gross = money(grossByRate.get(rateKey)!);
    const rate = toDecimal(rateKey);
    // Net base out of a gross amount: base = gross / (1 + rate/100).
    const base = PRICES_INCLUDE_VAT
      ? money(gross.div(toDecimal(1).add(rate.div(100))))
      : gross;
    const grossFinal = PRICES_INCLUDE_VAT
      ? gross
      : money(gross.add(gross.mul(rate.div(100))));
    const vat = money(grossFinal.sub(base));

    vatByRate.push({
      vatRate: rateKey,
      base: base.toFixed(2),
      vat: vat.toFixed(2),
    });
    subtotal = subtotal.add(base);
    vatAmount = vatAmount.add(vat);
    total = total.add(grossFinal);
  }

  return {
    subtotal: money(subtotal).toFixed(2),
    vatAmount: money(vatAmount).toFixed(2),
    total: money(total).toFixed(2),
    lineTotals,
    vatByRate,
  };
}
