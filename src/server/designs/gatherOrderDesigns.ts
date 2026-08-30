import { prisma } from "@/lib/db";
import { isR2Configured, presignDownload } from "@/lib/r2";

// "Point me to the files to use" (Flow 3, docs/05). For each order item we
// assemble the design files you actually open to make it:
//   - MASTER files for the chosen product (and matching design value), and
//   - CUSTOM files the customer uploaded for that specific line.
// Each file gets a short-lived presigned download URL (when R2 is configured).

export interface OrderDesignFile {
  id: string;
  kind: "MASTER" | "CUSTOM";
  label: string;
  fileName: string;
  storageKey: string;
  downloadUrl: string | null; // null when R2 isn't configured
}

export interface OrderItemDesigns {
  orderItemId: string;
  itemName: string;
  files: OrderDesignFile[];
}

export async function gatherOrderDesigns(
  orderId: string,
): Promise<OrderItemDesigns[]> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    include: { customDesigns: true },
    orderBy: { createdAt: "asc" },
  });

  const r2On = isR2Configured();
  const result: OrderItemDesigns[] = [];

  for (const item of items) {
    const files: OrderDesignFile[] = [];

    // Master library files for this product + (optionally) the chosen design.
    if (item.productId) {
      const masters = await prisma.designAsset.findMany({
        where: {
          kind: "MASTER",
          productId: item.productId,
          // Match the chosen design value, or masters not tied to a value.
          OR: [
            { designValue: item.design ?? undefined },
            { designValue: null },
          ],
        },
      });
      for (const m of masters) {
        files.push({
          id: m.id,
          kind: "MASTER",
          label: m.label ?? m.fileName,
          fileName: m.fileName,
          storageKey: m.storageKey,
          downloadUrl: r2On ? await presignDownload(m.storageKey) : null,
        });
      }
    }

    // Custom uploads for this line.
    for (const cu of item.customDesigns) {
      files.push({
        id: cu.id,
        kind: "CUSTOM",
        label: cu.label ?? cu.fileName,
        fileName: cu.fileName,
        storageKey: cu.storageKey,
        downloadUrl: r2On ? await presignDownload(cu.storageKey) : null,
      });
    }

    result.push({
      orderItemId: item.id,
      itemName: item.nameSnapshot,
      files,
    });
  }

  return result;
}
