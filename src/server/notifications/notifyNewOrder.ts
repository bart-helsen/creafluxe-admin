import { prisma } from "@/lib/db";
import { sendEmail, NOTIFY_EMAIL } from "@/lib/email";
import { formatEUR } from "@/lib/money";
import { gatherOrderDesigns } from "@/server/designs/gatherOrderDesigns";

// Flow 3 (docs/05): when a new order arrives, email you a summary with a deep
// link to the order and direct links to every design file to use. The attempt
// (success or failure) is recorded in NotificationLog so a lost alert is always
// traceable. Runs after the 201 is returned (fire-and-forget) so intake stays
// fast; failures never block an order from being saved.

const APP_URL = process.env.APP_URL ?? "https://admin.creafluxe.be";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function notifyNewOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, items: true },
  });
  if (!order) return;

  const designs = await gatherOrderDesigns(orderId);
  const filesByItem = new Map(designs.map((d) => [d.orderItemId, d.files]));
  const orderLink = `${APP_URL}/orders/${order.id}`;

  const itemRows = order.items
    .map((it) => {
      const opts = [it.material, it.size, it.style, it.design]
        .filter(Boolean)
        .join(" · ");
      const files = filesByItem.get(it.id) ?? [];
      const fileLinks = files.length
        ? files
            .map((f) => {
              const label = `${f.kind === "MASTER" ? "🗂️" : "📎"} ${esc(f.label)}`;
              return f.downloadUrl
                ? `<a href="${f.downloadUrl}">${label}</a>`
                : `${label} <span style="color:#999">(${esc(f.storageKey)})</span>`;
            })
            .join("<br>")
        : '<span style="color:#999">geen bestanden</span>';
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">
          <strong>${esc(it.nameSnapshot)}</strong>${opts ? `<br><span style="color:#666;font-size:12px">${esc(opts)}</span>` : ""}
          ${it.remarks ? `<br><span style="color:#666;font-size:12px">✏️ ${esc(it.remarks)}</span>` : ""}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${it.quantity}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${fileLinks}</td>
      </tr>`;
    })
    .join("");

  const delivery = order.deliveryRequested
    ? [
        order.deliveryStreet,
        [order.deliveryPostal, order.deliveryCity].filter(Boolean).join(" "),
        order.deliveryCountry,
      ]
        .filter(Boolean)
        .join(", ")
    : "Afhaling";

  const subject = `Nieuwe bestelling #${order.orderNumber} — ${order.customer.name}`;
  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1b1f24;max-width:640px">
    <h2 style="color:#16223a">Nieuwe bestelling #${order.orderNumber}</h2>
    <p style="margin:4px 0">
      <strong>${esc(order.customer.name)}</strong>
      ${order.customer.companyName ? ` — ${esc(order.customer.companyName)}` : ""}<br>
      ${esc(order.customer.email)}${order.customer.phone ? ` · ${esc(order.customer.phone)}` : ""}<br>
      Type: ${order.type} · Levering: ${esc(delivery)}
    </p>
    ${order.customerRemarks ? `<p style="background:#f5f6f8;padding:10px;border-radius:8px">💬 ${esc(order.customerRemarks)}</p>` : ""}
    ${order.designBrief ? `<p style="background:#f5f6f8;padding:10px;border-radius:8px">🎨 ${esc(order.designBrief)}</p>` : ""}
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">
      <thead>
        <tr style="background:#16223a;color:#fff">
          <th style="padding:6px 8px;text-align:left">Artikel</th>
          <th style="padding:6px 8px">Aantal</th>
          <th style="padding:6px 8px;text-align:left">Bestanden om te gebruiken</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="font-size:16px"><strong>Totaal: ${formatEUR(order.total.toString())}</strong> (incl. btw)</p>
    <p>
      <a href="${orderLink}" style="display:inline-block;background:#16223a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">
        Bestelling openen
      </a>
    </p>
    <p style="color:#999;font-size:12px">De bestandslinks hierboven verlopen na korte tijd; open de bestelling voor verse links.</p>
  </div>`;

  const result = await sendEmail({
    to: NOTIFY_EMAIL,
    subject,
    html,
    replyTo: order.customer.email,
  });

  await prisma.notificationLog.create({
    data: {
      type: "NEW_ORDER",
      channel: "email",
      orderId: order.id,
      subject,
      status: result.ok ? "SENT" : "FAILED",
      error: result.ok ? null : (result as { error: string }).error,
    },
  });
}
