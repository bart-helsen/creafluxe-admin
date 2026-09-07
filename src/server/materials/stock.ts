import { Prisma, type StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { notifyLowStock } from "@/server/notifications/notifyLowStock";
import { syncMaterialCostFromPreferred } from "@/server/materials/cost-sync";

// Stock is an append-only ledger (docs/11). Every change is a StockMovement with
// a SIGNED quantity; Material.stockQuantity is the cached running total, updated
// atomically in the same transaction so the two can never drift.
//
// A movement that pushes a material to/below its reorderLevel fires an immediate
// low-stock alert (best-effort, after the transaction commits) — so you're
// warned the moment an order eats the last of something, not just once a day.

export interface RecordMovementInput {
  materialId: string;
  type: StockMovementType;
  /** Magnitude entered by the user (always positive); we apply the sign below. */
  quantity: Prisma.Decimal | string | number;
  unitCost?: Prisma.Decimal | string | number | null; // for PURCHASE lines
  reason?: string | null;
  supplierId?: string | null;
  orderId?: string | null;
  createdById?: string | null;
}

// Which movement types add to stock and which remove from it. The UI always
// sends a positive magnitude; the type decides the sign, so you can't
// accidentally record a negative purchase.
const SIGN: Record<StockMovementType, 1 | -1> = {
  PURCHASE: 1,
  RETURN: 1, // returned into your stock / restocked
  CONSUMPTION: -1,
  WASTE: -1,
  ADJUSTMENT: 1, // signed adjustments handled below (can be negative)
};

/**
 * Record one stock movement and update the material's cached stockQuantity.
 * For ADJUSTMENT the caller may pass a negative quantity to correct downward;
 * every other type takes a positive magnitude and we apply the sign.
 * Returns the material's new stock level.
 */
export async function recordStockMovement(
  input: RecordMovementInput,
): Promise<{ stockQuantity: Prisma.Decimal; belowReorder: boolean }> {
  const magnitude = toDecimal(input.quantity);
  const signed =
    input.type === "ADJUSTMENT"
      ? magnitude // already signed by the caller
      : magnitude.abs().mul(SIGN[input.type]);

  const result = await prisma.$transaction(async (tx) => {
    const material = await tx.material.findUnique({
      where: { id: input.materialId },
      select: { stockQuantity: true, reorderLevel: true },
    });
    if (!material) throw new Error(`Material ${input.materialId} not found`);

    await tx.stockMovement.create({
      data: {
        materialId: input.materialId,
        type: input.type,
        quantity: signed,
        unitCost: input.unitCost != null ? toDecimal(input.unitCost) : undefined,
        reason: input.reason ?? undefined,
        supplierId: input.supplierId ?? undefined,
        orderId: input.orderId ?? undefined,
        createdById: input.createdById ?? undefined,
      },
    });

    const newQty = toDecimal(material.stockQuantity).add(signed);
    const updated = await tx.material.update({
      where: { id: input.materialId },
      data: {
        stockQuantity: newQty,
        // Unit cost is NOT touched here: it is derived from the preferred
        // supplier's price. A purchase feeds that supplier's price history
        // below instead of overwriting the working cost directly.
      },
      select: { stockQuantity: true, reorderLevel: true, active: true },
    });

    // A purchase keeps the supplier's price record current. If we know which
    // supplier and at what price, record it as this supplier's latest purchase
    // (creating the supplier link if it did not exist yet), then re-derive the
    // material's unit cost from whichever supplier is the Voorkeur. This way the
    // price still lives in exactly one place — on the supplier — and the cost
    // only moves when you buy from (or newly price) the preferred supplier.
    if (
      input.type === "PURCHASE" &&
      input.unitCost != null &&
      input.supplierId
    ) {
      const price = toDecimal(input.unitCost);
      await tx.supplierMaterial.upsert({
        where: {
          supplierId_materialId: {
            supplierId: input.supplierId,
            materialId: input.materialId,
          },
        },
        // Existing supplier: keep the reference unitPrice you set, just log the
        // latest purchase price and date.
        update: { lastPurchasePrice: price, lastPurchaseDate: new Date() },
        // First time buying this material from this supplier: seed the price
        // record from what you paid.
        create: {
          supplierId: input.supplierId,
          materialId: input.materialId,
          unitPrice: price,
          lastPurchasePrice: price,
          lastPurchaseDate: new Date(),
        },
      });
      await syncMaterialCostFromPreferred(tx, input.materialId);
    }

    const wasAbove = toDecimal(material.stockQuantity).gt(material.reorderLevel);
    const nowBelow = toDecimal(updated.stockQuantity).lte(updated.reorderLevel);
    return {
      stockQuantity: updated.stockQuantity,
      // Only "crossed the line downward" for an active, low material.
      belowReorder: updated.active && signed.isNeg() && wasAbove && nowBelow,
    };
  });

  // Immediate alert when a consumption/waste just crossed the reorder level.
  if (result.belowReorder) {
    try {
      await notifyLowStock([input.materialId], "consumption");
    } catch (err) {
      console.error(`[stock] low-stock alert failed for ${input.materialId}:`, err);
    }
  }

  return result;
}
