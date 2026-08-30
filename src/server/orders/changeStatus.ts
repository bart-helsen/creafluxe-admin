import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// Move an order along its lifecycle (Flow 4, docs/05). Every change writes an
// OrderStatusEvent, which powers the timeline on the order page and the audit
// history — no status is ever changed without a record of who/when/why.

export async function changeOrderStatus(params: {
  orderId: string;
  toStatus: OrderStatus;
  note?: string | null;
  changedById?: string | null;
}): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: { status: true },
  });
  if (!order) throw new Error(`Order ${params.orderId} not found`);
  if (order.status === params.toStatus) return; // no-op, don't log a non-change

  await prisma.$transaction([
    prisma.orderStatusEvent.create({
      data: {
        orderId: params.orderId,
        fromStatus: order.status,
        toStatus: params.toStatus,
        note: params.note ?? undefined,
        changedById: params.changedById ?? undefined,
      },
    }),
    prisma.order.update({
      where: { id: params.orderId },
      data: { status: params.toStatus },
    }),
  ]);
}

// The three buckets the dashboard shows (docs/03 + Flow 4).
export const STATUS_BUCKETS = {
  NEW: ["NEW"] as OrderStatus[],
  OPEN: ["QUOTE_SENT", "CONFIRMED", "IN_PRODUCTION", "READY"] as OrderStatus[],
  FINISHED: ["DELIVERED", "COMPLETED"] as OrderStatus[],
};

export const ALL_STATUSES: OrderStatus[] = [
  "NEW",
  "QUOTE_SENT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "Nieuw",
  QUOTE_SENT: "Offerte verstuurd",
  CONFIRMED: "Bevestigd",
  IN_PRODUCTION: "In productie",
  READY: "Klaar",
  DELIVERED: "Geleverd",
  COMPLETED: "Voltooid",
  CANCELLED: "Geannuleerd",
};
