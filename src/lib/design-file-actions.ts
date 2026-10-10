"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isR2Configured,
  buildCustomKey,
  buildMasterKey,
  putObject,
  resolveUploadMime,
  MAX_UPLOAD_BYTES,
} from "@/lib/r2";
import type { ActionState } from "@/components/ActionForm";

// Design files on orders. Until now only a request (Aanvraag) or a catalogue
// product could hold files, so a manual order, or a custom job created without a
// catalogue product, had nowhere to keep the file you cut it from.
//
// A file lives on one order item (`orderItemId`). Its kind says whether it is a
// one-off customer file (CUSTOM) or something you want to find and reuse later
// (MASTER). Flipping the kind is the "keep as master file" toggle; the file
// library (/files) lists every MASTER file whether it hangs on a product, an
// order or a request.

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user?.id);
}

const NOT_SIGNED_IN: ActionState = { error: "Je bent niet (meer) aangemeld." };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidateFiles(orderId?: string | null) {
  if (orderId) revalidatePath(`/orders/${orderId}`);
  revalidatePath("/files");
}

/** Attach a design file to an order item, optionally keeping it as a master. */
export async function uploadOrderItemFileAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await signedIn())) return NOT_SIGNED_IN;

  const orderItemId = str(formData, "orderItemId");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Kies een bestand om te uploaden." };
  }
  if (!isR2Configured()) {
    return { error: "Bestandsopslag (R2) is niet geconfigureerd — kan geen bestand opslaan." };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Bestand is groter dan 10 MB." };
  const mimeType = resolveUploadMime(file.name, file.type);
  if (!mimeType) {
    return { error: `Bestandstype niet toegestaan: ${file.type || file.name}.` };
  }

  const asMaster = formData.get("asMaster") != null;

  let orderId: string;
  try {
    const item = await prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: { orderId: true },
    });
    if (!item) return { error: "Artikel niet gevonden." };
    orderId = item.orderId;

    const storageKey = asMaster ? buildMasterKey(file.name) : buildCustomKey(file.name);
    await putObject(storageKey, Buffer.from(await file.arrayBuffer()), mimeType);
    await prisma.designAsset.create({
      data: {
        kind: asMaster ? "MASTER" : "CUSTOM",
        label: str(formData, "label") || file.name,
        storageKey,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        orderItemId,
      },
    });
  } catch (err) {
    console.error("[design-files] upload failed", err);
    return { error: "Het bestand kon niet opgeslagen worden." };
  }
  revalidateFiles(orderId);
  return { success: `${file.name} toegevoegd${asMaster ? " en bewaard als masterbestand" : ""}.` };
}

/**
 * The "keep as master file" toggle. Works for any file that hangs on an order
 * item or a request; catalogue masters (tied to a product) are managed on the
 * product page and are not touched here.
 */
export async function setFileMasterAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = str(formData, "id");
  const master = str(formData, "master") === "1";

  try {
    const asset = await prisma.designAsset.findUnique({
      where: { id },
      select: {
        productId: true,
        orderItem: { select: { orderId: true } },
      },
    });
    if (!asset) return { error: "Bestand niet gevonden." };
    if (asset.productId) {
      return { error: "Dit is een catalogusbestand — beheer het op de productpagina." };
    }
    await prisma.designAsset.update({
      where: { id },
      data: { kind: master ? "MASTER" : "CUSTOM" },
    });
    revalidateFiles(asset.orderItem?.orderId);
  } catch (err) {
    console.error("[design-files] toggle master failed", err);
    return { error: "Kon het bestand niet bijwerken." };
  }
  return { success: master ? "Bewaard als masterbestand." : "Niet langer masterbestand." };
}

/** Remove a one-off file from an order item. Masters must be un-mastered first. */
export async function deleteOrderItemFileAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = str(formData, "id");

  try {
    const asset = await prisma.designAsset.findUnique({
      where: { id },
      select: { kind: true, orderItem: { select: { orderId: true } } },
    });
    if (!asset?.orderItem) return { error: "Bestand niet gevonden." };
    if (asset.kind === "MASTER") {
      return { error: "Dit is een masterbestand. Haal eerst het masterbestand-vinkje weg." };
    }
    // The R2 object is left in place (same approach as the other file deletes).
    await prisma.designAsset.delete({ where: { id } });
    revalidateFiles(asset.orderItem.orderId);
  } catch (err) {
    console.error("[design-files] delete failed", err);
    return { error: "Het bestand kon niet verwijderd worden." };
  }
  return { success: "Bestand verwijderd." };
}
