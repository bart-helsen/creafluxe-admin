"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MaterialCategory, StockMovementType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { recordStockMovement } from "@/server/materials/stock";
import { syncMaterialCostFromPreferred } from "@/server/materials/cost-sync";

// Server actions behind the Phase 2b inventory screens (materials, suppliers,
// prices, stock movements, bill of materials). Each re-checks the session and
// revalidates the affected pages.

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length ? v : null;
}
function optDec(formData: FormData, key: string) {
  const v = str(formData, key);
  return v.length ? toDecimal(v) : null;
}

const CATEGORIES: MaterialCategory[] = [
  "WOOD",
  "PLASTIC",
  "METAL",
  "PAPER",
  "GADGET",
  "CONSUMABLE",
  "OTHER",
];

const MOVEMENT_TYPES: StockMovementType[] = [
  "PURCHASE",
  "CONSUMPTION",
  "ADJUSTMENT",
  "RETURN",
  "WASTE",
];

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function createSupplierAction(formData: FormData): Promise<void> {
  await requireUserId();
  const name = str(formData, "name");
  if (!name) throw new Error("Naam is verplicht.");

  const supplier = await prisma.supplier.create({
    data: {
      name,
      email: optStr(formData, "email"),
      phone: optStr(formData, "phone"),
      website: optStr(formData, "website"),
      customerNumber: optStr(formData, "customerNumber"),
      addressStreet: optStr(formData, "addressStreet"),
      addressPostal: optStr(formData, "addressPostal"),
      addressCity: optStr(formData, "addressCity"),
      addressCountry: optStr(formData, "addressCountry"),
      notes: optStr(formData, "notes"),
    },
  });
  revalidatePath("/suppliers");
  redirect(`/suppliers/${supplier.id}`);
}

export async function updateSupplierAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("Naam is verplicht.");

  await prisma.supplier.update({
    where: { id },
    data: {
      name,
      email: optStr(formData, "email"),
      phone: optStr(formData, "phone"),
      website: optStr(formData, "website"),
      customerNumber: optStr(formData, "customerNumber"),
      addressStreet: optStr(formData, "addressStreet"),
      addressPostal: optStr(formData, "addressPostal"),
      addressCity: optStr(formData, "addressCity"),
      addressCountry: optStr(formData, "addressCountry"),
      notes: optStr(formData, "notes"),
      active: formData.get("active") != null,
    },
  });
  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${id}`);
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export async function createMaterialAction(formData: FormData): Promise<void> {
  await requireUserId();
  const sku = str(formData, "sku");
  const name = str(formData, "name");
  const category = str(formData, "category") as MaterialCategory;
  if (!sku || !name) throw new Error("SKU en naam zijn verplicht.");

  // Optional reorder source: an existing supplier (picked) or a new one (named),
  // with its price and a link to this material's product page. The price you
  // give here is the material's price AT THAT SUPPLIER — there is no separate
  // material unit cost to keep in sync. The supplier is flagged Voorkeur, and
  // its price becomes the working unit cost (see syncMaterialCostFromPreferred).
  const existingSupplierId = optStr(formData, "supplierId");
  const newSupplierName = optStr(formData, "newSupplierName");
  const supplierPrice = optDec(formData, "supplierPrice");
  const productUrl = optStr(formData, "productUrl");

  const material = await prisma.$transaction(async (tx) => {
    const created = await tx.material.create({
      data: {
        sku,
        name,
        category: CATEGORIES.includes(category) ? category : "OTHER",
        description: optStr(formData, "description"),
        unit: str(formData, "unit") || "stuk",
        reorderLevel: toDecimal(str(formData, "reorderLevel") || "0"),
        reorderQuantity: optDec(formData, "reorderQuantity"),
        // unitCost is derived from the preferred supplier's price below; it stays
        // 0 until a supplier price exists.
        unitCost: toDecimal(0),
        notes: optStr(formData, "notes"),
        // stockQuantity stays 0; use a stock movement (or an opening ADJUSTMENT).
      },
    });

    // Resolve a supplier: an existing pick wins; otherwise create the named one.
    let supplierId = existingSupplierId;
    if (!supplierId && newSupplierName) {
      const supplier = await tx.supplier.create({ data: { name: newSupplierName } });
      supplierId = supplier.id;
    }

    if (supplierId) {
      await tx.supplierMaterial.create({
        data: {
          materialId: created.id,
          supplierId,
          unitPrice: supplierPrice ?? toDecimal(0),
          productUrl,
          isPreferred: true,
        },
      });
      // Mirror the preferred supplier's price onto the material's unit cost.
      await syncMaterialCostFromPreferred(tx, created.id);
    }
    return created;
  });

  revalidatePath("/materials");
  redirect(`/materials/${material.id}`);
}

export async function updateMaterialAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const name = str(formData, "name");
  const category = str(formData, "category") as MaterialCategory;
  if (!id || !name) throw new Error("Naam is verplicht.");

  await prisma.material.update({
    where: { id },
    data: {
      name,
      category: CATEGORIES.includes(category) ? category : "OTHER",
      description: optStr(formData, "description"),
      unit: str(formData, "unit") || "stuk",
      reorderLevel: toDecimal(str(formData, "reorderLevel") || "0"),
      reorderQuantity: optDec(formData, "reorderQuantity"),
      // unitCost is intentionally NOT set here: it is derived from the preferred
      // supplier's price. Manage the price on the supplier rows below instead.
      notes: optStr(formData, "notes"),
      active: formData.get("active") != null,
    },
  });
  revalidatePath("/materials");
  revalidatePath(`/materials/${id}`);
}

// ---------------------------------------------------------------------------
// Stock movements
// ---------------------------------------------------------------------------

export async function recordMovementAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const materialId = str(formData, "materialId");
  const type = str(formData, "type") as StockMovementType;
  if (!materialId || !MOVEMENT_TYPES.includes(type)) {
    throw new Error("Onbekend materiaal of type.");
  }
  const quantity = str(formData, "quantity");
  if (!quantity) throw new Error("Aantal is verplicht.");

  await recordStockMovement({
    materialId,
    type,
    quantity, // magnitude; recordStockMovement applies the sign per type
    unitCost: type === "PURCHASE" ? optDec(formData, "unitCost") : null,
    reason: optStr(formData, "reason"),
    supplierId: optStr(formData, "supplierId"),
    createdById: userId,
  });

  revalidatePath(`/materials/${materialId}`);
  revalidatePath("/materials");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Supplier prices for a material (SupplierMaterial) + current supplier
// ---------------------------------------------------------------------------

export async function upsertSupplierPriceAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const materialId = str(formData, "materialId");
  const supplierId = str(formData, "supplierId");
  if (!materialId || !supplierId) throw new Error("Kies een leverancier.");
  const unitPrice = str(formData, "unitPrice");
  if (!unitPrice) throw new Error("Prijs is verplicht.");

  const isPreferred = formData.get("isPreferred") != null;

  await prisma.$transaction(async (tx) => {
    if (isPreferred) {
      // Only one preferred supplier per material.
      await tx.supplierMaterial.updateMany({
        where: { materialId },
        data: { isPreferred: false },
      });
    }
    await tx.supplierMaterial.upsert({
      where: { supplierId_materialId: { supplierId, materialId } },
      update: {
        unitPrice: toDecimal(unitPrice),
        supplierSku: optStr(formData, "supplierSku"),
        productUrl: optStr(formData, "productUrl"),
        packSize: optDec(formData, "packSize"),
        packPrice: optDec(formData, "packPrice"),
        minOrderQty: optDec(formData, "minOrderQty"),
        leadTimeDays: str(formData, "leadTimeDays")
          ? Number(str(formData, "leadTimeDays"))
          : null,
        isPreferred,
      },
      create: {
        materialId,
        supplierId,
        unitPrice: toDecimal(unitPrice),
        supplierSku: optStr(formData, "supplierSku"),
        productUrl: optStr(formData, "productUrl"),
        packSize: optDec(formData, "packSize"),
        packPrice: optDec(formData, "packPrice"),
        minOrderQty: optDec(formData, "minOrderQty"),
        leadTimeDays: str(formData, "leadTimeDays")
          ? Number(str(formData, "leadTimeDays"))
          : null,
        isPreferred,
      },
    });
    // Re-derive the material's unit cost from whichever supplier is preferred.
    await syncMaterialCostFromPreferred(tx, materialId);
  });

  revalidatePath(`/materials/${materialId}`);
}

// Mark one existing supplier price as the material's Voorkeur (preferred). The
// preferred supplier's price is the working unit cost, so switching it here is
// the one place that changes what a product costs.
export async function setPreferredSupplierAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const materialId = str(formData, "materialId");
  const supplierId = str(formData, "supplierId");
  if (!materialId || !supplierId) throw new Error("Kies een leverancier.");

  await prisma.$transaction(async (tx) => {
    await tx.supplierMaterial.updateMany({
      where: { materialId },
      data: { isPreferred: false },
    });
    await tx.supplierMaterial.update({
      where: { supplierId_materialId: { supplierId, materialId } },
      data: { isPreferred: true },
    });
    await syncMaterialCostFromPreferred(tx, materialId);
  });

  revalidatePath(`/materials/${materialId}`);
}

export async function deleteSupplierPriceAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const materialId = str(formData, "materialId");
  await prisma.$transaction(async (tx) => {
    await tx.supplierMaterial.delete({ where: { id } });
    // If the deleted row was the Voorkeur, another is elected (or the cost
    // falls back to 0 when no supplier price remains).
    await syncMaterialCostFromPreferred(tx, materialId);
  });
  revalidatePath(`/materials/${materialId}`);
}

// ---------------------------------------------------------------------------
// Bill of materials (ProductMaterial)
// ---------------------------------------------------------------------------

export async function upsertBomLineAction(formData: FormData): Promise<void> {
  await requireUserId();
  const productId = str(formData, "productId");
  const materialId = str(formData, "materialId");
  const quantity = str(formData, "quantity");
  if (!productId || !materialId || !quantity) {
    throw new Error("Materiaal en hoeveelheid zijn verplicht.");
  }

  await prisma.productMaterial.upsert({
    where: { productId_materialId: { productId, materialId } },
    update: { quantity: toDecimal(quantity), notes: optStr(formData, "notes") },
    create: {
      productId,
      materialId,
      quantity: toDecimal(quantity),
      notes: optStr(formData, "notes"),
    },
  });
  revalidatePath(`/products/${productId}`);
}

export async function deleteBomLineAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const productId = str(formData, "productId");
  await prisma.productMaterial.delete({ where: { id } });
  revalidatePath(`/products/${productId}`);
}
