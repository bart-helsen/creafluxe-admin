import { prisma } from "@/lib/db";
import { nextRequestNumber } from "@/server/counters";
import { upsertIntakeCustomer } from "@/server/customers/upsertIntakeCustomer";
import { resolveCustomer } from "@/server/orders/createManualOrder";
import { notifyNewRequest } from "@/server/notifications/notifyNewRequest";
import { MANUAL_ORDER_CHANNELS } from "@/lib/manual-order";
import { assetFromKey } from "@/server/orders/createOrder";
import type { IntakeInput, ManualRequestInput } from "@/lib/validation";

// A custom job starts life as a request (Aanvraag), not an order: there is no
// price yet. Two ways in — the website's Atelier form (through the intake API)
// and "Nieuwe aanvraag" in the admin for people who ask by phone, e-mail, in
// person or on social media.

export interface CreateRequestResult {
  requestId: string;
  requestNumber: number;
  duplicate: boolean;
}

/**
 * The brief for an intake request. The Atelier form sends a free-text
 * designBrief; if lines were sent too (older clients), list them so nothing
 * the customer asked for is lost.
 */
export function intakeDescription(input: IntakeInput): string {
  const parts: string[] = [];
  if (input.designBrief) parts.push(input.designBrief);
  if (input.items.length > 0) {
    const lines = input.items.map((it) => {
      const opts = [it.material, it.size, it.style, it.design].filter(Boolean).join(", ");
      const remark = it.remarks ? ` — ${it.remarks}` : "";
      return `• ${it.quantity} × ${it.name}${opts ? ` (${opts})` : ""}${remark}`;
    });
    parts.push(`Gevraagde artikelen:\n${lines.join("\n")}`);
  }
  return parts.join("\n\n") || "(geen omschrijving)";
}

/** Website intake with type CUSTOM → a new request (idempotent on clientRef). */
export async function createRequestFromIntake(
  input: IntakeInput,
): Promise<CreateRequestResult> {
  if (input.clientRef) {
    const existing = await prisma.quoteRequest.findUnique({
      where: { clientRef: input.clientRef },
    });
    if (existing) {
      return {
        requestId: existing.id,
        requestNumber: existing.requestNumber,
        duplicate: true,
      };
    }
  }

  const customer = await upsertIntakeCustomer(input.customer);
  const delivery = input.delivery;
  // Files already uploaded to R2 by the website (if it ever sends them) are
  // attached to the request, so they're there when you make the offer.
  const uploadKeys = [...new Set(input.items.flatMap((it) => it.uploadKeys))];

  const request = await prisma.$transaction(async (tx) => {
    const requestNumber = await nextRequestNumber(tx);
    return tx.quoteRequest.create({
      data: {
        requestNumber,
        status: "NEW",
        channel: "website",
        clientRef: input.clientRef ?? undefined,
        customerId: customer.id,
        description: intakeDescription(input),
        customerRemarks: input.customerRemarks ?? undefined,
        deliveryRequested: delivery?.requested ?? false,
        deliveryStreet: delivery?.street ?? undefined,
        deliveryPostal: delivery?.postal ?? undefined,
        deliveryCity: delivery?.city ?? undefined,
        deliveryCountry: delivery?.country ?? undefined,
        deliveryNotes: delivery?.notes ?? undefined,
        attachments: {
          create: uploadKeys.map((key) => {
            const { fileName, mimeType } = assetFromKey(key);
            return { kind: "CUSTOM" as const, storageKey: key, fileName, mimeType };
          }),
        },
        events: {
          create: {
            kind: "CREATED",
            toStatus: "NEW",
            note: "Ontvangen via het Atelier-formulier op de website",
          },
        },
      },
    });
  });

  // Best-effort e-mail to you; the request is already saved.
  try {
    await notifyNewRequest(request.id);
  } catch (err) {
    console.error(`[intake] request notification failed for ${request.id}:`, err);
  }

  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    duplicate: false,
  };
}

/** "Nieuwe aanvraag" in the admin. No notification — you created it yourself. */
export async function createManualRequest(
  input: ManualRequestInput,
  userId: string,
): Promise<{ requestId: string; requestNumber: number }> {
  const delivery = input.delivery;
  const channelLabel = MANUAL_ORDER_CHANNELS[input.channel];
  const note = [`Manueel aangemaakt (${channelLabel.toLowerCase()})`, input.internalNote]
    .filter(Boolean)
    .join(" — ");

  const request = await prisma.$transaction(async (tx) => {
    const customer = await resolveCustomer(tx, input.customer);
    const requestNumber = await nextRequestNumber(tx);
    return tx.quoteRequest.create({
      data: {
        requestNumber,
        status: "NEW",
        channel: input.channel,
        customerId: customer.id,
        title: input.title,
        description: input.description,
        customerRemarks: input.customerRemarks,
        deliveryRequested: delivery.requested,
        deliveryStreet: delivery.requested ? delivery.street : null,
        deliveryPostal: delivery.requested ? delivery.postal : null,
        deliveryCity: delivery.requested ? delivery.city : null,
        deliveryCountry: delivery.requested ? delivery.country : null,
        deliveryNotes: delivery.requested ? delivery.notes : null,
        events: {
          create: { kind: "CREATED", toStatus: "NEW", note, userId },
        },
      },
    });
  });

  return { requestId: request.id, requestNumber: request.requestNumber };
}
