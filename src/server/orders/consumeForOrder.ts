import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { recordStockMovement } from "@/server/materials/stock";

// Auto-deduct on production (docs/11). When an order enters production, the
// materials its catalogue items consume (per each product's bill of materials)
// are removed from stock as CONSUMPTION movements linked to the order — keeping
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

  const items = await prisma.orderItem.findMany({
    where: { orderId, productId: { not: null } },
    select: { productId: true, quantity: true },
  });
  if (items.length === 0) return { consumed: 0 };

  // Sum required quantity per material across all lines of the order.
  const required = new Map<string, ReturnType<typeof toDecimal>>();
  for (const item of items) {
    const bom = await prisma.productMaterial.findMany({
      where: { productId: item.productId! },
      select: { materialId: true, quantity: true },
    });
    for (const b of bom) {
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
