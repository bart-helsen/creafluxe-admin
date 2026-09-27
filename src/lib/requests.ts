// Labels and small helpers for custom requests (Aanvragen) and offers
// (Offertes). Shared by server code and client components, so this file stays
// free of Prisma / server imports.

export type RequestStatusValue =
  | "NEW"
  | "IN_REVIEW"
  | "WAITING_CUSTOMER"
  | "OFFER_SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "CANCELLED";

export type OfferStatusValue = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";

export type RequestEventKindValue =
  | "CREATED"
  | "STATUS"
  | "NOTE"
  | "QUESTION"
  | "ANSWER"
  | "OFFER";

export const REQUEST_STATUS_LABELS: Record<RequestStatusValue, string> = {
  NEW: "Nieuw",
  IN_REVIEW: "In behandeling",
  WAITING_CUSTOMER: "Wacht op klant",
  OFFER_SENT: "Offerte verstuurd",
  ACCEPTED: "Aanvaard",
  DECLINED: "Afgewezen",
  CANCELLED: "Geannuleerd",
};

/** The tabs on the Aanvragen list. */
export const REQUEST_BUCKETS = {
  OPEN: ["NEW", "IN_REVIEW", "WAITING_CUSTOMER", "OFFER_SENT"],
  ACCEPTED: ["ACCEPTED"],
  CLOSED: ["DECLINED", "CANCELLED"],
} satisfies Record<string, RequestStatusValue[]>;

export type RequestBucket = keyof typeof REQUEST_BUCKETS;

export const REQUEST_BUCKET_LABELS: Record<RequestBucket, string> = {
  OPEN: "Open",
  ACCEPTED: "Aanvaard",
  CLOSED: "Afgesloten",
};

/**
 * Statuses you can pick by hand on a request. ACCEPTED is deliberately not in
 * the list: a request only becomes "Aanvaard" by accepting an offer, which is
 * what creates the order.
 */
export const MANUAL_REQUEST_STATUSES: RequestStatusValue[] = [
  "NEW",
  "IN_REVIEW",
  "WAITING_CUSTOMER",
  "OFFER_SENT",
  "DECLINED",
  "CANCELLED",
];

export const OFFER_STATUS_LABELS: Record<OfferStatusValue, string> = {
  DRAFT: "Concept",
  SENT: "Verstuurd",
  ACCEPTED: "Aanvaard",
  DECLINED: "Geweigerd",
  SUPERSEDED: "Vervangen",
};

export const REQUEST_EVENT_LABELS: Record<RequestEventKindValue, string> = {
  CREATED: "Aanvraag ontvangen",
  STATUS: "Status gewijzigd",
  NOTE: "Notitie",
  QUESTION: "Vraag aan klant",
  ANSWER: "Antwoord van klant",
  OFFER: "Offerte",
};

/** Kinds you can log by hand in the request timeline. */
export const LOGGABLE_EVENT_KINDS = ["NOTE", "QUESTION", "ANSWER"] as const;
export type LoggableEventKind = (typeof LOGGABLE_EVENT_KINDS)[number];

/** "A-12" — kept distinct from order numbers (#12) so they're never confused. */
export function formatRequestNumber(n: number): string {
  return `A-${n}`;
}

/** A short title for lists: the working title, else the start of the brief. */
export function requestTitle(r: { title: string | null; description: string }): string {
  if (r.title?.trim()) return r.title.trim();
  const first = r.description.trim().split(/\r?\n/)[0] ?? "";
  return first.length > 70 ? `${first.slice(0, 67).trimEnd()}…` : first || "Maatwerk";
}
