import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { recordStockMovement } from "@/server/materials/stock";

// Auto-deduct on production (docs/11). When an order enters production, the
// materials its items consume (per each product's bill of materials, or per the
// costing of the accepted offer line for custom work) are removed from stock as CONSUMPTION movements linked to the order — keeping
// stock honest without manual bookkeeping.
//
// Idempotent: if this order already has CONSUMPTION movements it is a no-op, so
// re-entering IN_PRODUCTION (or a status bounce) never double-deducts.

export async function consumeForOrder(
  orderId: string,
  changedById?: string | null,
): Promise<{ consumed: number }> {
  const already = await prisma.stockMovement.count({
    where: { orderId, type: "CONSUMPTION" },
  });
  if (already > 0) return { consumed: 0 };

  // Catalogue lines consume their product's bill of materials; lines that came
  // from an accepted offer consume the materials costed on that offer line.
  const items = await prisma.orderItem.findMany({
    where: { orderId, OR: [{ productId: { not: null } }, { offerLineId: { not: null } }] },
    select: { productId: true, offerLineId: true, quantity: true },
  });
  if (items.length === 0) return { consumed: 0 };

  // Sum required quantity per material across all lines of the order.
  const required = new Map<string, ReturnType<typeof toDecimal>>();
  for (const item of items) {
    const perPiece = item.productId
      ? await prisma.productMaterial.findMany({
          where: { productId: item.productId },
          select: { materialId: true, quantity: true },
        })
      : await prisma.offerLineMaterial.findMany({
          where: { offerLineId: item.offerLineId! },
          select: { materialId: true, quantity: true },
        });
    for (const b of perPiece) {
      const need = toDecimal(b.quantity).mul(item.quantity);
      required.set(
        b.materialId,
        (required.get(b.materialId) ?? toDecimal(0)).add(need),
      );
    }
  }
  if (required.size === 0) return { consumed: 0 };

  let consumed = 0;
  for (const [materialId, qty] of required) {
    if (qty.lte(0)) continue;
    await recordStockMovement({
      materialId,
      type: "CONSUMPTION",
      quantity: qty,
      orderId,
      reason: "Automatisch verbruik bij productie",
      createdById: changedById ?? null,
    });
    consumed++;
  }

  return { consumed };
}
