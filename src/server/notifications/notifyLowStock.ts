import { prisma } from "@/lib/db";
import { sendEmail, NOTIFY_EMAIL } from "@/lib/email";
import { formatEUR } from "@/lib/money";

// Low-stock alert (docs/11). Emails you which materials are at/below their
// reorder level, how much to reorder, and from whom at what price — so
// reordering is a quick action. Fired two ways:
//   - "cron": the daily Railway scan of every active material (all currently low).
//   - "consumption": immediately when a movement just pushed one below the line.
// Every attempt is recorded in NotificationLog (type LOW_STOCK), like Flow 3.

const APP_URL = process.env.APP_URL ?? "https://admin.creafluxe.be";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Send a low-stock alert for the given materials (or, when no ids are passed,
 * for every active material currently at/below its reorder level). Returns the
 * number of low materials reported (0 = nothing to alert, no email sent).
 */
export async function notifyLowStock(
  materialIds?: string[],
  trigger: "cron" | "consumption" = "cron",
): Promise<number> {
  const materials = await prisma.material.findMany({
    where: {
      active: true,
      ...(materialIds && materialIds.length
        ? { id: { in: materialIds } }
        : {}),
    },
    include: { currentSupplier: true },
    orderBy: { name: "asc" },
  });

  // Only those actually at/below the reorder level right now.
  const low = materials.filter(
    (m) => Number(m.stockQuantity) <= Number(m.reorderLevel),
  );
  if (low.length === 0) return 0;

  const rows = low
    .map((m) => {
      const supplier = m.currentSupplier
        ? esc(m.currentSupplier.name)
        : '<span style="color:#999">geen leverancier</span>';
      const reorderQty = m.reorderQuantity != null ? Number(m.reorderQuantity) : null;
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">
          <strong>${esc(m.name)}</strong><br>
          <span style="color:#666;font-size:12px">${esc(m.sku)}</span>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">
          ${Number(m.stockQuantity)} ${esc(m.unit)}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">
          ${Number(m.reorderLevel)} ${esc(m.unit)}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">
          ${reorderQty != null ? `${reorderQty} ${esc(m.unit)}` : "—"}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">
          ${supplier}<br>
          <span style="color:#666;font-size:12px">${formatEUR(m.unitCost.toString())}/${esc(m.unit)}</span>
        </td>
      </tr>`;
    })
    .join("");

  const subject =
    low.length === 1
      ? `Lage voorraad: ${low[0].name}`
      : `Lage voorraad: ${low.length} materialen bijbestellen`;

  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1b1f24;max-width:680px">
    <h2 style="color:#16223a">⚠️ Lage voorraad</h2>
    <p style="margin:4px 0">
      ${low.length === 1 ? "Dit materiaal is" : `Deze ${low.length} materialen zijn`}
      op of onder het bestelpunt${trigger === "consumption" ? " door een recente verwerking" : ""}.
    </p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">
      <thead>
        <tr style="background:#16223a;color:#fff">
          <th style="padding:6px 8px;text-align:left">Materiaal</th>
          <th style="padding:6px 8px;text-align:right">Voorraad</th>
          <th style="padding:6px 8px;text-align:right">Bestelpunt</th>
          <th style="padding:6px 8px;text-align:right">Bestellen</th>
          <th style="padding:6px 8px;text-align:left">Leverancier</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p>
      <a href="${APP_URL}/materials?filter=low" style="display:inline-block;background:#16223a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">
        Materialen openen
      </a>
    </p>
  </div>`;

  const result = await sendEmail({ to: NOTIFY_EMAIL, subject, html });

  await prisma.notificationLog.create({
    data: {
      type: "LOW_STOCK",
      channel: "email",
      subject,
      status: result.ok ? "SENT" : "FAILED",
      error: result.ok ? null : (result as { error: string }).error,
    },
  });

  return low.length;
}
