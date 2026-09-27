import type { RequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { REQUEST_STATUS_LABELS, type LoggableEventKind } from "@/lib/requests";

// The request timeline: status changes, notes, and the back-and-forth with the
// customer. Every change is written as a RequestEvent so you always see who did
// what, when — the same idea as the order status history.

/** A problem the user should see (shown in the form), not a crash. */
export class RequestError extends Error {}

const CLOSED: RequestStatus[] = ["ACCEPTED"];

/** Change a request's status by hand (not to ACCEPTED — that's via an offer). */
export async function changeRequestStatus(params: {
  requestId: string;
  toStatus: RequestStatus;
  note?: string | null;
  userId?: string | null;
}): Promise<void> {
  if (params.toStatus === "ACCEPTED") {
    throw new RequestError(
      "Een aanvraag wordt 'Aanvaard' door een offerte te laten aanvaarden.",
    );
  }
  const request = await prisma.quoteRequest.findUnique({
    where: { id: params.requestId },
    select: { status: true },
  });
  if (!request) throw new RequestError("Aanvraag niet gevonden.");
  if (CLOSED.includes(request.status)) {
    throw new RequestError("Deze aanvraag is al omgezet in een bestelling.");
  }
  if (request.status === params.toStatus && !params.note) return;

  await prisma.$transaction([
    prisma.requestEvent.create({
      data: {
        requestId: params.requestId,
        kind: "STATUS",
        fromStatus: request.status,
        toStatus: params.toStatus,
        note: params.note ?? undefined,
        userId: params.userId ?? undefined,
      },
    }),
    prisma.quoteRequest.update({
      where: { id: params.requestId },
      data: { status: params.toStatus },
    }),
  ]);
}

/**
 * Where a logged event moves the request:
 *   - you asked the customer something → "Wacht op klant"
 *   - the customer answered            → back to "In behandeling"
 * A note never changes the status, and a request with an offer out stays
 * "Offerte verstuurd" (the offer is what you're waiting on).
 */
export function statusAfterEvent(
  current: RequestStatus,
  kind: LoggableEventKind,
): RequestStatus {
  if (kind === "QUESTION" && (current === "NEW" || current === "IN_REVIEW")) {
    return "WAITING_CUSTOMER";
  }
  if (kind === "ANSWER" && current === "WAITING_CUSTOMER") return "IN_REVIEW";
  return current;
}

/** Log a note, a question to the customer, or the customer's answer. */
export async function logRequestEvent(params: {
  requestId: string;
  kind: LoggableEventKind;
  note: string;
  userId?: string | null;
}): Promise<{ from: RequestStatus; to: RequestStatus }> {
  const request = await prisma.quoteRequest.findUnique({
    where: { id: params.requestId },
    select: { status: true },
  });
  if (!request) throw new RequestError("Aanvraag niet gevonden.");

  const to = statusAfterEvent(request.status, params.kind);
  const changed = to !== request.status;

  await prisma.$transaction([
    prisma.requestEvent.create({
      data: {
        requestId: params.requestId,
        kind: params.kind,
        fromStatus: changed ? request.status : undefined,
        toStatus: changed ? to : undefined,
        note: params.note,
        userId: params.userId ?? undefined,
      },
    }),
    ...(changed
      ? [
          prisma.quoteRequest.update({
            where: { id: params.requestId },
            data: { status: to },
          }),
        ]
      : []),
  ]);

  return { from: request.status, to };
}

/** Human line for a status move, e.g. "Nieuw → Wacht op klant". */
export function describeStatusMove(from: RequestStatus, to: RequestStatus): string {
  return `${REQUEST_STATUS_LABELS[from]} → ${REQUEST_STATUS_LABELS[to]}`;
}
