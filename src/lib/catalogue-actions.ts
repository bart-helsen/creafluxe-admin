"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductOptionType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { money, toDecimal } from "@/lib/money";
import { computeProductBuildCost } from "@/server/materials/costing";
import {
  isR2Configured,
  buildMasterKey,
  putObject,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
} from "@/lib/r2";

// Belgian standard VAT. The cost calculator works excl. VAT, but the catalogue
// basePrice is stored incl. VAT, so a promoted price is grossed up by this.
const DEFAULT_VAT_RATE = "21";

// Server actions behind the Phase 2 catalogue + customer screens. Each re-checks
// the session (defence in depth on top of the middleware) and revalidates the
// affected pages so the UI reflects the change immediately.

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

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function createProductAction(formData: FormData): Promise<void> {
  await requireUserId();
  const sku = str(formData, "sku");
  const name = str(formData, "name");
  if (!sku || !name) throw new Error("SKU en naam zijn verplicht.");

  const product = await prisma.product.create({
    data: {
      sku,
      name,
      description: optStr(formData, "description"),
      basePrice: money(str(formData, "basePrice") || "0"),
      vatRate: toDecimal(str(formData, "vatRate") || "21"),
      filter: optStr(formData, "filter"),
      active: formData.get("active") != null,
      showOnWebshop: formData.get("showOnWebshop") != null,
      sortOrder: Number(str(formData, "sortOrder") || "0") || 0,
    },
  });

  revalidatePath("/products");
  redirect(`/products/${product.id}`);
}

// ---------------------------------------------------------------------------
// Promote a calculated cost to the catalogue
// ---------------------------------------------------------------------------
//
// Called from the cost calculator once you're happy with a price. Creates the
// catalogue product (hidden from the webshop by default), copies the material
// lines into its bill of materials, and stores the machine/labour inputs plus a
// snapshot of the cost/price decision in ProductCosting. The totals are
// recomputed here server-side — never trusted from the form.
export async function promoteToCatalogueAction(formData: FormData): Promise<void> {
  await requireUserId();

  const sku = str(formData, "sku");
  const name = str(formData, "name");
  if (!sku || !name) {
    throw new Error("SKU en productnaam zijn verplicht om te promoveren.");
  }

  const machineId = optStr(formData, "machineId");
  const machineMinutes = Number(str(formData, "machineMinutes") || "0") || 0;
  const hours = Number(str(formData, "hours") || "0") || 0;
  const finalPriceRaw = str(formData, "finalPrice");
  const finalPrice = finalPriceRaw ? Number(finalPriceRaw) : null;
  const finalPriceInclVat = str(formData, "finalPriceVat") === "incl";
  const vatRateNum = Number(str(formData, "vatRate") || DEFAULT_VAT_RATE) || 21;

  // Material lines arrive as parallel materialId[] / quantity[] arrays, exactly
  // like the calculator form itself submits them.
  const materialIds = formData.getAll("materialId").map((v) => String(v));
  const quantities = formData.getAll("quantity").map((v) => String(v));
  const lines = materialIds
    .map((materialId, i) => ({ materialId, quantity: quantities[i] ?? "0" }))
    .filter((l) => l.materialId && Number(l.quantity) > 0);

  // Recompute authoritatively (validates materials, applies current rates, and
  // splits the final price into excl/incl per the chosen VAT mode).
  const cost = await computeProductBuildCost({
    machineId,
    machineMinutes,
    lines,
    hours,
    finalPrice,
    finalPriceInclVat,
    vatRate: vatRateNum,
  });

  // The catalogue basePrice is stored INCL. VAT; the promotion snapshot keeps
  // the net (excl.) price. Both come straight from the calculator's own split,
  // so a round B2C incl. price stays round and a round B2B net price stays round.
  const vatRate = toDecimal(vatRateNum);
  const priceExcl = money(finalPrice != null ? cost.finalPrice! : cost.roundedPrice);
  const basePrice = money(
    finalPrice != null ? cost.finalPriceIncl! : cost.roundedPriceIncl,
  );

  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        sku,
        name,
        basePrice,
        vatRate,
        active: true,
        showOnWebshop: false, // hidden from the webshop until you decide otherwise
      },
    });

    // Copy the calculator's material lines into the bill of materials. Only the
    // lines that resolved to real materials (cost.materialLines) are written.
    if (cost.materialLines.length > 0) {
      await tx.productMaterial.createMany({
        data: cost.materialLines.map((l) => ({
          productId: p.id,
          materialId: l.materialId,
          quantity: toDecimal(l.quantity),
        })),
        skipDuplicates: true, // guard against the same material picked twice
      });
    }

    await tx.productCosting.create({
      data: {
        productId: p.id,
        machineId: machineId ?? null,
        machineMinutes: machineMinutes > 0 ? toDecimal(machineMinutes) : null,
        labourHours: hours > 0 ? toDecimal(hours) : null,
        costAtPromotion: toDecimal(cost.totalCost),
        priceAtPromotion: priceExcl,
        markupPercent: toDecimal(cost.markupPercent),
      },
    });

    return p;
  });

  revalidatePath("/products");
  redirect(`/products/${product.id}`);
}

export async function updateProductAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("Naam is verplicht.");

  await prisma.product.update({
    where: { id },
    data: {
      name,
      description: optStr(formData, "description"),
      basePrice: money(str(formData, "basePrice") || "0"),
      vatRate: toDecimal(str(formData, "vatRate") || "21"),
      filter: optStr(formData, "filter"),
      active: formData.get("active") != null,
      showOnWebshop: formData.get("showOnWebshop") != null,
      sortOrder: Number(str(formData, "sortOrder") || "0") || 0,
    },
  });

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}

// ---------------------------------------------------------------------------
// Product options (materials / sizes / styles / designs)
// ---------------------------------------------------------------------------

const OPTION_TYPES: ProductOptionType[] = ["MATERIAL", "SIZE", "STYLE", "DESIGN"];

export async function addOptionAction(formData: FormData): Promise<void> {
  await requireUserId();
  const productId = str(formData, "productId");
  const type = str(formData, "type") as ProductOptionType;
  const value = str(formData, "value");
  if (!productId || !OPTION_TYPES.includes(type) || !value) {
    throw new Error("Type en waarde zijn verplicht.");
  }

  await prisma.productOption.upsert({
    where: { productId_type_value: { productId, type, value } },
    update: {
      priceDelta: money(str(formData, "priceDelta") || "0"),
      active: true,
    },
    create: {
      productId,
      type,
      value,
      priceDelta: money(str(formData, "priceDelta") || "0"),
    },
  });

  revalidatePath(`/products/${productId}`);
}

export async function deleteOptionAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const productId = str(formData, "productId");
  await prisma.productOption.delete({ where: { id } });
  revalidatePath(`/products/${productId}`);
}

// ---------------------------------------------------------------------------
// Master design files — uploaded through the server action straight to R2.
// ---------------------------------------------------------------------------

export async function uploadMasterAction(formData: FormData): Promise<void> {
  await requireUserId();
  const productId = str(formData, "productId");
  const file = formData.get("file");
  if (!productId) throw new Error("Onbekend product.");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Kies een bestand om te uploaden.");
  }
  if (!isR2Configured()) {
    throw new Error(
      "Bestandsopslag (R2) is niet geconfigureerd — kan geen masterbestand uploaden.",
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Bestand is groter dan 10 MB.");
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_UPLOAD_MIME.has(mimeType)) {
    throw new Error(`Bestandstype niet toegestaan: ${mimeType}.`);
  }

  const storageKey = buildMasterKey(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  await putObject(storageKey, bytes, mimeType);

  await prisma.designAsset.create({
    data: {
      kind: "MASTER",
      label: optStr(formData, "label") ?? file.name,
      storageKey,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      productId,
      designValue: optStr(formData, "designValue"),
    },
  });

  revalidatePath(`/products/${productId}`);
}

export async function deleteMasterAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const productId = str(formData, "productId");
  // We only remove the DB record; the R2 object can be garbage-collected later.
  await prisma.designAsset.delete({ where: { id } });
  revalidatePath(`/products/${productId}`);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function updateCustomerAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  if (!id) throw new Error("Onbekende klant.");

  // E-mail can only be added when the customer has none yet (manual orders
  // allow phone-only customers); an existing e-mail stays fixed.
  const newEmail = str(formData, "email").toLowerCase();
  let email: string | undefined;
  if (newEmail) {
    const current = await prisma.customer.findUnique({
      where: { id },
      select: { email: true },
    });
    if (current && !current.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      email = newEmail;
    }
  }

  await prisma.customer.update({
    where: { id },
    data: {
      name: str(formData, "name") || undefined,
      ...(email ? { email } : {}),
      phone: optStr(formData, "phone"),
      isBusiness: formData.get("isBusiness") != null,
      vatNumber: optStr(formData, "vatNumber"),
      companyName: optStr(formData, "companyName"),
      addressStreet: optStr(formData, "addressStreet"),
      addressPostal: optStr(formData, "addressPostal"),
      addressCity: optStr(formData, "addressCity"),
      addressCountry: optStr(formData, "addressCountry"),
      notes: optStr(formData, "notes"),
    },
  });

  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
}
