/**
 * One-time backfill: align every material's unit cost with its preferred
 * ("Voorkeur") supplier's price.
 *
 * Since the unit cost is now DERIVED from the preferred supplier's price (you no
 * longer type it on the material itself), run this once after deploying that
 * change so existing materials stop showing their old hand-typed cost. From then
 * on the app keeps them in sync automatically whenever a supplier price changes.
 *
 * For each material:
 *   - No supplier prices              → unit cost set to 0, no current supplier.
 *   - A preferred supplier price      → unit cost = that price.
 *   - Prices but none flagged Voorkeur → the cheapest is elected and flagged, so
 *                                        a cost is always defined.
 *
 * Usage:
 *   npx tsx scripts/sync-material-costs.ts        # apply
 *   npx tsx scripts/sync-material-costs.ts --dry  # preview only, no writes
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const DRY = process.argv.includes("--dry");

function eur(d: Prisma.Decimal) {
  return `€${d.toFixed(4)}`;
}

async function main() {
  const materials = await prisma.material.findMany({
    orderBy: { name: "asc" },
    include: { supplierMaterials: true },
  });

  let changed = 0;
  for (const m of materials) {
    const prices = [...m.supplierMaterials].sort((a, b) => {
      const cmp = a.unitPrice.comparedTo(b.unitPrice);
      if (cmp !== 0) return cmp;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    let targetCost = new Prisma.Decimal(0);
    let targetSupplierId: string | null = null;
    let electId: string | null = null; // supplierMaterial id to flag preferred

    if (prices.length > 0) {
      const preferred = prices.find((p) => p.isPreferred) ?? prices[0];
      targetCost = preferred.unitPrice;
      targetSupplierId = preferred.supplierId;
      if (!preferred.isPreferred) electId = preferred.id;
    }

    const costDiffers = !m.unitCost.equals(targetCost);
    const supplierDiffers = (m.currentSupplierId ?? null) !== targetSupplierId;
    if (!costDiffers && !supplierDiffers && !electId) continue;

    changed++;
    console.log(
      `${m.sku} — ${m.name}: ${eur(m.unitCost)} → ${eur(targetCost)}` +
        (electId ? " (voorkeur toegewezen)" : ""),
    );

    if (DRY) continue;

    await prisma.$transaction(async (tx) => {
      if (electId) {
        await tx.supplierMaterial.updateMany({
          where: { materialId: m.id },
          data: { isPreferred: false },
        });
        await tx.supplierMaterial.update({
          where: { id: electId },
          data: { isPreferred: true },
        });
      }
      await tx.material.update({
        where: { id: m.id },
        data: { unitCost: targetCost, currentSupplierId: targetSupplierId },
      });
    });
  }

  console.log(
    `\n${DRY ? "[dry run] " : ""}${changed} materia${changed === 1 ? "al" : "len"} ${
      DRY ? "zouden wijzigen" : "bijgewerkt"
    }, ${materials.length} bekeken.\n`,
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
