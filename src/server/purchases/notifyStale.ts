import type { PurchaseInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail, NOTIFY_EMAIL } from "@/lib/email";
import { formatDate, formatEUR } from "@/lib/money";
import { PURCHASE_STATUS_LABELS, purchaseTitle } from "@/lib/purchases";

// Nudge e-mail: purchase invoices stuck in "Te controleren" or "Klaar voor
// Dexxter" for more than STALE_DAYS. Triggered by a scheduler calling
// /api/cron/purchase-reminders (see README). Safe to run as often as you like:
// each invoice is mentioned at most once every REMIND_EVERY_DAYS, so a daily
// cron gives a nudge every few days, not a daily pile of mail.

export const STALE_DAYS = 7;
export const REMIND_EVERY_DAYS = 3;
// Scheduler runs never start at exactly the same second, so "3 days" between a
// Thursday and a Sunday run can come out a little short. Allow some slack so a
// slightly early run still counts as due.
const SLACK_HOURS = 6;

const DAY = 86_400_000;
const APP_URL = process.env.APP_URL ?? "https://admin.creafluxe.be";

export interface ReminderCandidate {
  id: string;
  status: PurchaseInvoiceStatus;
  statusChangedAt: Date;
  lastRemindedAt: Date | null;
}

/**
 * Which invoices are stale, and whether a reminder is due now. A reminder is
 * due when at least one stale invoice hasn't been mentioned for
 * REMIND_EVERY_DAYS; the e-mail then lists ALL stale invoices.
 */
export function pickReminders<T extends ReminderCandidate>(
  invoices: T[],
  now: Date,
): { stale: T[]; due: boolean } {
  const stale = invoices.filter(
    (i) =>
      (i.status === "RECEIVED" || i.status === "CHECKED") &&
      now.getTime() - i.statusChangedAt.getTime() > STALE_DAYS * DAY,
  );
  const due = stale.some(
    (i) =>
      !i.lastRemindedAt ||
      now.getTime() - i.lastRemindedAt.getTime() >= REMIND_EVERY_DAYS * DAY - SLACK_HOURS * 3_600_000,
  );
  return { stale, due };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Send the nudge when one is due. Returns how many stale invoices it listed (0 = no mail). */
export async function notifyStalePurchases(now: Date = new Date()): Promise<number> {
  const open = await prisma.purchaseInvoice.findMany({
    where: { status: { in: ["RECEIVED", "CHECKED"] } },
    select: {
      id: true,
      status: true,
      statusChangedAt: true,
      lastRemindedAt: true,
      supplierName: true,
      invoiceNumber: true,
      fileName: true,
      invoiceDate: true,
      grossAmount: true,
      currency: true,
    },
    orderBy: { statusChangedAt: "asc" },
  });
  const { stale, due } = pickReminders(open, now);
  if (!due) return 0;

  const received = stale.filter((i) => i.status === "RECEIVED").length;
  const checked = stale.length - received;

  const rows = stale
    .map((i) => {
      const days = Math.floor((now.getTime() - i.statusChangedAt.getTime()) / DAY);
      const amount =
        i.grossAmount == null
          ? "—"
          : i.currency === "EUR"
            ? formatEUR(i.grossAmount.toString())
            : `${i.currency} ${i.grossAmount.toString()}`;
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">
          <a href="${APP_URL}/purchases/${i.id}" style="color:#16223a"><strong>${esc(purchaseTitle(i))}</strong></a>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${formatDate(i.invoiceDate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${amount}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${PURCHASE_STATUS_LABELS[i.status]}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${days} d</td>
      </tr>`;
    })
    .join("");

  const parts = [
    received ? `${received} te controleren` : null,
    checked ? `${checked} klaar voor Dexxter` : null,
  ].filter(Boolean);
  const subject = `Inkoopfacturen wachten: ${parts.join(", ")}`;

  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1b1f24;max-width:680px">
    <h2 style="color:#16223a">Inkoopfacturen wachten op je</h2>
    <p style="margin:4px 0">
      Deze facturen staan al meer dan ${STALE_DAYS} dagen in dezelfde stap.
      ${checked ? "Download het Dexxter-pakket en upload ze in één keer." : ""}
    </p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">
      <thead>
        <tr style="background:#16223a;color:#fff">
          <th style="padding:6px 8px;text-align:left">Factuur</th>
          <th style="padding:6px 8px;text-align:left">Datum</th>
          <th style="padding:6px 8px;text-align:right">Bedrag</th>
          <th style="padding:6px 8px;text-align:left">Stap</th>
          <th style="padding:6px 8px;text-align:right">Wacht</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p>
      <a href="${APP_URL}/purchases" style="display:inline-block;background:#16223a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">
        Inkoopfacturen openen
      </a>
    </p>
  </div>`;

  const result = await sendEmail({ to: NOTIFY_EMAIL, subject, html });

  await prisma.$transaction([
    prisma.notificationLog.create({
      data: {
        type: "PURCHASE_INVOICE_REMINDER",
        channel: "email",
        subject,
        status: result.ok ? "SENT" : "FAILED",
        error: result.ok ? null : (result as { error: string }).error,
      },
    }),
    ...(result.ok
      ? [
          prisma.purchaseInvoice.updateMany({
            where: { id: { in: stale.map((i) => i.id) } },
            data: { lastRemindedAt: now },
          }),
        ]
      : []),
  ]);

  return stale.length;
}
