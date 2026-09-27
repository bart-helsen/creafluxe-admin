"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RequestStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import {
  manualRequestSchema,
  offerSaveSchema,
  requestDetailsSchema,
  requestEventSchema,
  requestStatusSchema,
} from "@/lib/validation";
import {
  isR2Configured,
  buildCustomKey,
  putObject,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
} from "@/lib/r2";
import { createManualRequest } from "@/server/requests/createRequest";
import {
  RequestError,
  changeRequestStatus,
  describeStatusMove,
  logRequestEvent,
} from "@/server/requests/requestEvents";
import {
  acceptOffer,
  createOffer,
  declineOffer,
  deleteDraftOffer,
  markOfferSent,
  saveOffer,
} from "@/server/offers/offers";
import { ManualOrderError } from "@/server/orders/createManualOrder";
import type { ActionState } from "@/components/ActionForm";

// Server actions behind the Aanvragen (custom requests) and Offertes screens.
// Each re-checks the session, validates its input, and turns expected problems
// (RequestError) into a message on the form instead of an error page.

async function userId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const NOT_SIGNED_IN: ActionState = { error: "Je bent niet (meer) aangemeld." };

function fail(err: unknown, fallback: string): ActionState {
  if (err instanceof RequestError || err instanceof ManualOrderError) {
    return { error: err.message };
  }
  console.error(`[requests] ${fallback}`, err);
  return { error: fallback };
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidateRequest(requestId: string) {
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** "Nieuwe aanvraag": the client form posts its state as one JSON field. */
export async function createManualRequestAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;

  let raw: unknown;
  try {
    raw = JSON.parse(str(formData, "payload"));
  } catch {
    return { error: "Het formulier kon niet gelezen worden. Probeer opnieuw." };
  }
  const parsed = manualRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Controleer de ingevulde gegevens." };
  }

  let requestId: string;
  try {
    ({ requestId } = await createManualRequest(parsed.data, uid));
  } catch (err) {
    return fail(err, "De aanvraag kon niet opgeslagen worden.");
  }

  revalidatePath("/requests");
  revalidatePath("/customers");
  revalidatePath("/");
  redirect(`/requests/${requestId}`);
}

export async function updateRequestDetailsAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await userId())) return NOT_SIGNED_IN;
  const requestId = str(formData, "requestId");
  const parsed = requestDetailsSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    customerRemarks: formData.get("customerRemarks"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await prisma.quoteRequest.update({ where: { id: requestId }, data: parsed.data });
  } catch (err) {
    return fail(err, "De aanvraag kon niet bijgewerkt worden.");
  }
  revalidateRequest(requestId);
  return { success: "Aanvraag bijgewerkt." };
}

export async function logRequestEventAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const requestId = str(formData, "requestId");
  const parsed = requestEventSchema.safeParse({
    kind: formData.get("kind"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    const { from, to } = await logRequestEvent({ requestId, ...parsed.data, userId: uid });
    revalidateRequest(requestId);
    return {
      success:
        from === to ? "Toegevoegd aan de tijdlijn." : `Toegevoegd · ${describeStatusMove(from, to)}.`,
    };
  } catch (err) {
    return fail(err, "Kon niet toevoegen aan de tijdlijn.");
  }
}

export async function changeRequestStatusAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const requestId = str(formData, "requestId");
  const parsed = requestStatusSchema.safeParse({
    status: formData.get("status"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await changeRequestStatus({
      requestId,
      toStatus: parsed.data.status as RequestStatus,
      note: parsed.data.note,
      userId: uid,
    });
  } catch (err) {
    return fail(err, "De status kon niet gewijzigd worden.");
  }
  revalidateRequest(requestId);
  return { success: "Status opgeslagen." };
}

/** Attach a file (sketch, photo, design) to a request — stored in R2. */
export async function uploadRequestFileAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await userId())) return NOT_SIGNED_IN;
  const requestId = str(formData, "requestId");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Kies een bestand om te uploaden." };
  }
  if (!isR2Configured()) {
    return { error: "Bestandsopslag (R2) is niet geconfigureerd — kan geen bestand opslaan." };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Bestand is groter dan 10 MB." };
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_UPLOAD_MIME.has(mimeType)) {
    return { error: `Bestandstype niet toegestaan: ${mimeType}.` };
  }

  try {
    const request = await prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });
    if (!request) return { error: "Aanvraag niet gevonden." };
    const storageKey = buildCustomKey(file.name);
    await putObject(storageKey, Buffer.from(await file.arrayBuffer()), mimeType);
    await prisma.designAsset.create({
      data: {
        kind: "CUSTOM",
        label: str(formData, "label") || file.name,
        storageKey,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        requestId,
      },
    });
  } catch (err) {
    return fail(err, "Het bestand kon niet opgeslagen worden.");
  }
  revalidateRequest(requestId);
  return { success: `${file.name} toegevoegd.` };
}

export async function deleteRequestFileAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await userId())) return NOT_SIGNED_IN;
  const id = str(formData, "id");
  const requestId = str(formData, "requestId");
  try {
    // Only unlink files that haven't moved onto an order yet; the R2 object can
    // be garbage-collected later (same approach as master files).
    const res = await prisma.designAsset.deleteMany({
      where: { id, requestId, orderItemId: null },
    });
    if (res.count === 0) {
      return { error: "Dit bestand hoort al bij de bestelling en blijft bewaard." };
    }
  } catch (err) {
    return fail(err, "Het bestand kon niet verwijderd worden.");
  }
  revalidateRequest(requestId);
  return { success: "Bestand verwijderd." };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** New offer on a request (or a new version copied from an existing one). */
export async function createOfferAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const requestId = str(formData, "requestId");
  const copyFromOfferId = str(formData, "copyFromOfferId") || null;

  let offerId: string;
  try {
    ({ offerId } = await createOffer({ requestId, userId: uid, copyFromOfferId }));
  } catch (err) {
    return fail(err, "De offerte kon niet aangemaakt worden.");
  }
  revalidateRequest(requestId);
  redirect(`/offers/${offerId}`);
}

/** Save the offer editor (JSON payload, like the manual order form). */
export async function saveOfferAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  if (!(await userId())) return NOT_SIGNED_IN;
  const offerId = str(formData, "offerId");

  let raw: unknown;
  try {
    raw = JSON.parse(str(formData, "payload"));
  } catch {
    return { error: "Het formulier kon niet gelezen worden. Probeer opnieuw." };
  }
  const parsed = offerSaveSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Controleer de ingevulde gegevens." };
  }

  try {
    await saveOffer(offerId, parsed.data);
    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      select: { requestId: true, total: true },
    });
    revalidatePath(`/offers/${offerId}`);
    if (offer) revalidateRequest(offer.requestId);
    return {
      success: `Offerte opgeslagen · totaal ${formatEUR(offer?.total.toString() ?? "0")} incl. btw.`,
    };
  } catch (err) {
    return fail(err, "De offerte kon niet opgeslagen worden.");
  }
}

async function offerRequestId(offerId: string): Promise<string | null> {
  const o = await prisma.offer.findUnique({ where: { id: offerId }, select: { requestId: true } });
  return o?.requestId ?? null;
}

export async function markOfferSentAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const offerId = str(formData, "offerId");
  try {
    await markOfferSent(offerId, uid);
  } catch (err) {
    return fail(err, "Kon de offerte niet als verstuurd markeren.");
  }
  const requestId = await offerRequestId(offerId);
  revalidatePath(`/offers/${offerId}`);
  if (requestId) revalidateRequest(requestId);
  return { success: "Gemarkeerd als verstuurd." };
}

export async function acceptOfferAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const offerId = str(formData, "offerId");
  const note = str(formData, "note") || null;

  let orderId: string;
  try {
    ({ orderId } = await acceptOffer({ offerId, userId: uid, note }));
  } catch (err) {
    return fail(err, "De offerte kon niet omgezet worden in een bestelling.");
  }
  const requestId = await offerRequestId(offerId);
  revalidatePath(`/offers/${offerId}`);
  if (requestId) revalidateRequest(requestId);
  revalidatePath("/orders");
  revalidatePath("/invoices");
  redirect(`/orders/${orderId}`);
}

export async function declineOfferAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const offerId = str(formData, "offerId");
  try {
    await declineOffer({
      offerId,
      userId: uid,
      closeRequest: formData.get("closeRequest") != null,
      note: str(formData, "note") || null,
    });
  } catch (err) {
    return fail(err, "Kon de offerte niet als geweigerd markeren.");
  }
  const requestId = await offerRequestId(offerId);
  revalidatePath(`/offers/${offerId}`);
  if (requestId) revalidateRequest(requestId);
  return { success: "Offerte gemarkeerd als geweigerd." };
}

export async function deleteOfferAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const uid = await userId();
  if (!uid) return NOT_SIGNED_IN;
  const offerId = str(formData, "offerId");
  let requestId: string;
  try {
    ({ requestId } = await deleteDraftOffer(offerId, uid));
  } catch (err) {
    return fail(err, "Het concept kon niet verwijderd worden.");
  }
  revalidateRequest(requestId);
  redirect(`/requests/${requestId}`);
}
