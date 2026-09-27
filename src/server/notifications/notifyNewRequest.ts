import { prisma } from "@/lib/db";
import { sendEmail, NOTIFY_EMAIL } from "@/lib/email";
import { formatRequestNumber } from "@/lib/requests";

// When a custom request arrives from the website's Atelier form, e-mail you a
// short summary with a link to the request in the admin. Like the new-order
// mail, every attempt is logged in NotificationLog.

const APP_URL = process.env.APP_URL ?? "https://admin.creafluxe.be";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function notifyNewRequest(requestId: string): Promise<void> {
  const request = await prisma.quoteRequest.findUnique({
    where: { id: requestId },
    include: { customer: true },
  });
  if (!request) return;

  const number = formatRequestNumber(request.requestNumber);
  const link = `${APP_URL}/requests/${request.id}`;
  const delivery = request.deliveryRequested
    ? [
        request.deliveryStreet,
        [request.deliveryPostal, request.deliveryCity].filter(Boolean).join(" "),
        request.deliveryCountry,
      ]
        .filter(Boolean)
        .join(", ")
    : "Afhaling";

  const subject = `Nieuwe aanvraag ${number} — ${request.customer.name}`;
  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1b1f24;max-width:640px">
    <h2 style="color:#16223a">Nieuwe aanvraag ${number}</h2>
    <p style="margin:4px 0">
      <strong>${esc(request.customer.name)}</strong><br>
      ${esc(request.customer.email)}${request.customer.phone ? ` · ${esc(request.customer.phone)}` : ""}<br>
      Levering: ${esc(delivery)}
    </p>
    <p style="background:#f5f6f8;padding:10px;border-radius:8px;white-space:pre-wrap">🎨 ${esc(request.description)}</p>
    ${request.customerRemarks ? `<p style="background:#f5f6f8;padding:10px;border-radius:8px">💬 ${esc(request.customerRemarks)}</p>` : ""}
    <p>
      <a href="${link}" style="display:inline-block;background:#16223a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">
        Aanvraag openen
      </a>
    </p>
    <p style="color:#999;font-size:12px">Bijlagen van de klant komen voorlopig nog via de gewone offerte-mail binnen.</p>
  </div>`;

  const result = await sendEmail({
    to: NOTIFY_EMAIL,
    subject,
    html,
    replyTo: request.customer.email || undefined,
  });

  await prisma.notificationLog.create({
    data: {
      type: "NEW_REQUEST",
      channel: "email",
      requestId: request.id,
      subject,
      status: result.ok ? "SENT" : "FAILED",
      error: result.ok ? null : (result as { error: string }).error,
    },
  });
}
