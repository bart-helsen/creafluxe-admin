"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurchaseInvoiceStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseAmount } from "@/lib/purchases";
import { purchaseSaveSchema } from "@/lib/validation";
import { MAX_PURCHASE_BYTES, isR2Configured, resolvePurchaseMime } from "@/lib/r2";
import {
  PurchaseError,
  bookPurchaseStock,
  changePurchaseStatus,
  deletePurchaseInvoice,
  markUploadedToDexxter,
  receivePurchaseInvoice,
  savePurchaseInvoice,
} from "@/server/purchases/purchaseInvoices";
import type { ActionState } from "@/components/ActionForm";

// Server actions behind the Inkoopfacturen screens. Each re-checks the session,
// validates its input, and turns expected problems (PurchaseError) into a
// message on the form instead of an error page.

async function userId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const NOT_SIGNED_IN: ActionState = { error: "Je bent niet (meer) aangemeld." };

function fail(err: unknown, fallback: string): ActionState {
  if (err instanceof PurchaseError) return { error: err.message };
  console.error(`[purchases] ${fallback}`, err);
  return { error: fallback };
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidatePurchases(id?: string) {
  if (id) revalidatePath(`/purchases/${id}`);
  revalidatePath("/purchases");
  revalidatePath("/purchases/quarter");
  revalidatePath("/purchases/pack");
  revalidatePath("/");
}

/** Upload one or more invoice files (PDF or photo); each becomes an invoice. */
export async function uploadPurchaseInvoicesAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;

  // "Zonder bestand invoeren": an empty record to type in by hand.
  if (str(formData, "mode") === "manual") {
    let id: string;
    try {
      ({ id } = await receivePurchaseInvoice({ source: "UPLOAD", userId: uid }));
    } catch (err) {
      return fail(err, "De inkoopfactuur kon niet aangemaakt worden.");
    }
    revalidatePurchases();
    redirect(`/purchases/${id}`);
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Kies of fotografeer minstens één factuur." };
  if (!isR2Configured()) {
    return {
      error:
        "Bestandsopslag (R2) is niet geconfigureerd — kies ‘Zonder bestand invoeren’ of stel R2 in.",
    };
  }

  const prepared: { file: File; mimeType: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_PURCHASE_BYTES) return { error: `${file.name} is groter dan 10 MB.` };
    const mimeType = resolvePurchaseMime(file.name, file.type);
    if (!mimeType) {
      return { error: `${file.name}: alleen PDF, JPG, PNG of WebP.` };
    }
    prepared.push({ file, mimeType });
  }

  const ids: string[] = [];
  try {
    for (const { file, mimeType } of prepared) {
      const { id } = await receivePurchaseInvoice({
        file: { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType },
        source: "UPLOAD",
        userId: uid,
      });
      ids.push(id);
    }
  } catch (err) {
    revalidatePurchases();
    const base = fail(err, "Het bestand kon niet opgeslagen worden.");
    return ids.length ? { error: `${ids.length} opgeslagen; daarna fout: ${base.error}` } : base;
  }

  revalidatePurchases();
  redirect(ids.length === 1 ? `/purchases/${ids[0]}` : "/purchases?bucket=RECEIVED");
}

/** The review form: "Opslaan" keeps the status; "Bevestigen" → Klaar voor Dexxter. */
export async function savePurchaseInvoiceAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const id = str(formData, "id");
  const intent = str(formData, "intent");

  const parsed = purchaseSaveSchema.safeParse({
    supplierId: formData.get("supplierId"),
    supplierName: formData.get("supplierName"),
    supplierCountry: formData.get("supplierCountry"),
    supplierVatNumber: formData.get("supplierVatNumber"),
    invoiceNumber: formData.get("invoiceNumber"),
    invoiceDate: formData.get("invoiceDate"),
    currency: formData.get("currency") || "EUR",
    netAmount: formData.get("netAmount"),
    vatAmount: formData.get("vatAmount"),
    grossAmount: formData.get("grossAmount"),
    amountEur: formData.get("amountEur"),
    vatTreatment: formData.get("vatTreatment"),
    category: formData.get("category"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Controleer de ingevulde gegevens." };
  }

  let status: PurchaseInvoiceStatus;
  try {
    ({ status } = await savePurchaseInvoice({
      id,
      input: parsed.data,
      confirm: intent === "confirm",
      userId: uid,
    }));
  } catch (err) {
    return fail(err, "De inkoopfactuur kon niet opgeslagen worden.");
  }
  revalidatePurchases(id);

  if (intent === "confirm") {
    // Keep the routine moving: straight on to the next one waiting for review.
    const next = await prisma.purchaseInvoice.findFirst({
      where: { status: "RECEIVED", id: { not: id } },
      orderBy: { receivedAt: "asc" },
      select: { id: true },
    });
    redirect(next ? `/purchases/${next.id}?confirmed=1` : "/purchases?bucket=CHECKED&confirmed=1");
  }
  return { success: status === "CHECKED" ? "Wijzigingen opgeslagen." : "Opgeslagen — nog niet bevestigd." };
}

/** Step back: Klaar voor Dexxter → Te controleren, or In Dexxter → Klaar voor Dexxter. */
export async function changePurchaseStatusAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const id = str(formData, "id");
  const to = str(formData, "toStatus") as PurchaseInvoiceStatus;
  if (!["RECEIVED", "CHECKED", "UPLOADED_TO_DEXXTER"].includes(to)) return { error: "Onbekende status." };
  try {
    await changePurchaseStatus({ id, toStatus: to, note: str(formData, "note") || null, userId: uid });
  } catch (err) {
    return fail(err, "De status kon niet gewijzigd worden.");
  }
  revalidatePurchases(id);
  return { success: "Status gewijzigd." };
}

/** Bulk: mark the invoices from the pack as uploaded to Dexxter. */
export async function markUploadedAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return { error: "Vink minstens één factuur aan." };
  let count: number;
  try {
    count = await markUploadedToDexxter(ids, uid);
  } catch (err) {
    return fail(err, "Kon de facturen niet als geüpload markeren.");
  }
  revalidatePurchases();
  return {
    success:
      count === ids.length
        ? `${count} factuur${count === 1 ? "" : "en"} gemarkeerd als ‘In Dexxter’.`
        : `${count} van ${ids.length} gemarkeerd — de andere waren niet (meer) ‘Klaar voor Dexxter’.`,
  };
}

export async function deletePurchaseInvoiceAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await userId())) return NOT_SIGNED_IN;
  try {
    await deletePurchaseInvoice(str(formData, "id"));
  } catch (err) {
    return fail(err, "De inkoopfactuur kon niet verwijderd worden.");
  }
  revalidatePurchases();
  redirect("/purchases");
}

/** Optional: book material bought on this invoice into stock. */
export async function bookPurchaseStockAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const id = str(formData, "id");
  const materialId = str(formData, "materialId");
  const quantity = parseAmount(str(formData, "quantity"));
  const unitCostRaw = str(formData, "unitCost");
  const unitCost = unitCostRaw ? parseAmount(unitCostRaw) : null;
  if (!materialId) return { error: "Kies een materiaal." };
  if (!quantity || quantity.startsWith("-") || quantity === "0.00") return { error: "Geef een aantal op." };
  if (unitCostRaw && unitCost == null) return { error: "Ongeldige prijs per eenheid." };

  try {
    await bookPurchaseStock({ purchaseInvoiceId: id, materialId, quantity, unitCost, userId: uid });
  } catch (err) {
    return fail(err, "Kon de voorraad niet inboeken.");
  }
  revalidatePath(`/purchases/${id}`);
  revalidatePath(`/materials/${materialId}`);
  revalidatePath("/materials");
  return { success: "Ingeboekt in de voorraad." };
}
