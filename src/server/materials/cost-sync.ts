import type { Prisma } from "@prisma/client";
import { toDecimal } from "@/lib/money";

// Single source of truth for a material's unit cost.
// -----------------------------------------------------------------------------
// The price of a material lives with its suppliers (SupplierMaterial.unitPrice).
// Exactly one supplier is the "Voorkeur" (preferred) supplier and its price is
// THE working unit cost used by every costing helper. You type a price only once
// — on the supplier row — never on the material itself. Material.unitCost is only
// a cached mirror of the preferred supplier's price, kept in sync by this helper
// so nothing can drift and there is never a second place to update.
//
// Call it inside a transaction after ANY change to a material's supplier prices:
// adding, editing, deleting a price, changing which supplier is preferred, or
// booking a purchase.
//
// Rules:
//   - No supplier prices                    → unitCost 0, no current supplier.
//   - A preferred price                     → unitCost = that price; the current
//                                             supplier points at it.
//   - Prices exist but none is flagged      → elect the cheapest and flag it, so
//     (e.g. after deleting the preferred)     a Voorkeur — and thus a cost — is
//                                             always defined.
//   - Never leaves more than one preferred flag set.
export async function syncMaterialCostFromPreferred(
  tx: Prisma.TransactionClient,
  materialId: string,
): Promise<void> {
  const prices = await tx.supplierMaterial.findMany({
    where: { materialId },
    orderBy: [{ unitPrice: "asc" }, { createdAt: "asc" }],
  });

  if (prices.length === 0) {
    await tx.material.update({
      where: { id: materialId },
      data: { currentSupplierId: null, unitCost: toDecimal(0) },
    });
    return;
  }

  // The preferred row if one is flagged, otherwise the cheapest known price.
  const preferred = prices.find((p) => p.isPreferred) ?? prices[0];

  // Make sure exactly one row carries the preferred flag.
  const hasStrayFlag = prices.some(
    (p) => p.isPreferred && p.id !== preferred.id,
  );
  if (hasStrayFlag) {
    await tx.supplierMaterial.updateMany({
      where: { materialId, id: { not: preferred.id } },
      data: { isPreferred: false },
    });
  }
  if (!preferred.isPreferred) {
    await tx.supplierMaterial.update({
      where: { id: preferred.id },
      data: { isPreferred: true },
    });
  }

  await tx.material.update({
    where: { id: materialId },
    data: {
      currentSupplierId: preferred.supplierId,
      unitCost: preferred.unitPrice,
    },
  });
}
