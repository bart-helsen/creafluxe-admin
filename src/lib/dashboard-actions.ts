"use server";

import { revalidatePath } from "next/cache";
import type { InvoiceStatus, OrderStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { changeOrderStatus, ALL_STATUSES } from "@/server/orders/changeStatus";
import { createDraftInvoice } from "@/server/invoices/createDraftInvoice";
import { issueInvoice } from "@/server/invoices/issueInvoice";

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
  const allowed: InvoiceStatus[] = ["SENT", "PAID", "OVERDUE", "CANCELLED"];
  if (!allowed.includes(status)) throw new Error("Invalid invoice status");

  await prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
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
