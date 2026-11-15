"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { InvoiceStatus, OrderStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { changeOrderStatus, ALL_STATUSES } from "@/server/orders/changeStatus";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";
import { issueInvoice } from "@/server/invoices/issueInvoice";
import {
  deleteDraftInvoice,
  InvoiceActionError,
} from "@/server/invoices/deleteDraftInvoice";
import { cancelInvoiceWithCreditNote } from "@/server/invoices/cancelInvoice";
import type { ActionState } from "@/components/ActionForm";

// Server actions behind the admin order/invoice screens (docs/04 §B). Each
// re-checks the session (defence in depth on top of the middleware) and
// revalidates the affected pages so the UI reflects the change immediately.

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

export async function changeStatusAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const orderId = String(formData.get("orderId"));
  const toStatus = String(formData.get("toStatus")) as OrderStatus;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!ALL_STATUSES.includes(toStatus)) throw new Error("Invalid status");

  await changeOrderStatus({ orderId, toStatus, note, changedById: userId });
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/");
}

export async function regenerateInvoiceAction(formData: FormData): Promise<void> {
  await requireUserId();
  const orderId = String(formData.get("orderId"));
  const invoiceId = await createDraftInvoice(orderId);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}

export async function issueInvoiceAction(formData: FormData): Promise<void> {
  await requireUserId();
  const invoiceId = String(formData.get("invoiceId"));
  await issueInvoice(invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/");
}

export async function setInvoiceStatusAction(formData: FormData): Promise<void> {
  await requireUserId();
  const invoiceId = String(formData.get("invoiceId"));
  const status = String(formData.get("status")) as InvoiceStatus;
  // CANCELLED is not settable here: cancelling always goes through a credit
  // note (cancelInvoiceAction). Drafts are issued, not status-edited.
  const allowed: InvoiceStatus[] = ["ISSUED", "SENT", "PAID", "OVERDUE"];
  if (!allowed.includes(status)) throw new Error("Invalid invoice status");

  const res = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: { in: allowed } },
    data: { status },
  });
  if (res.count === 0) throw new Error("Deze factuur kan niet van status veranderen.");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}

export async function saveDexxterRefAction(formData: FormData): Promise<void> {
  await requireUserId();
  const invoiceId = String(formData.get("invoiceId"));
  const dexxterRef = String(formData.get("dexxterRef") ?? "").trim() || null;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { dexxterRef } });
  revalidatePath(`/invoices/${invoiceId}`);
}

// ---------------------------------------------------------------------------
// Removing / cancelling an invoice, independently of the order.

/** Delete a DRAFT invoice (no number yet, so no gap). Back to the order. */
export async function deleteDraftInvoiceAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUserId();
  const invoiceId = String(formData.get("invoiceId"));
  let orderId: string;
  try {
    ({ orderId } = await deleteDraftInvoice(invoiceId));
  } catch (err) {
    if (err instanceof InvoiceActionError) return { error: err.message };
    console.error("[invoice] delete draft failed:", err);
    return { error: "Het concept kon niet verwijderd worden." };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  // Outside the try/catch: redirect() works by throwing.
  redirect(`/orders/${orderId}`);
}

/** Cancel an issued invoice by creating a full credit note. */
export async function cancelInvoiceAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUserId();
  const invoiceId = String(formData.get("invoiceId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;
  try {
    const { orderId, creditNoteNumber } = await cancelInvoiceWithCreditNote({ invoiceId, reason });
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/invoices");
    revalidatePath("/");
    return { success: `Creditnota ${creditNoteNumber} aangemaakt.` };
  } catch (err) {
    if (err instanceof InvoiceActionError) return { error: err.message };
    console.error("[invoice] cancel failed:", err);
    return { error: "De creditnota kon niet aangemaakt worden." };
  }
}

export async function saveCreditNoteDexxterRefAction(formData: FormData): Promise<void> {
  await requireUserId();
  const creditNoteId = String(formData.get("creditNoteId"));
  const dexxterRef = String(formData.get("dexxterRef") ?? "").trim() || null;
  const cn = await prisma.creditNote.update({
    where: { id: creditNoteId },
    data: { dexxterRef },
    select: { invoiceId: true },
  });
  revalidatePath(`/invoices/${cn.invoiceId}`);
  revalidatePath("/invoices");
}
