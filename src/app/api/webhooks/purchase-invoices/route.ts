import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { purchaseInboundSchema } from "@/lib/validation";
import { isR2Configured } from "@/lib/r2";
import { receiveInboundFiles } from "@/server/purchases/inbound";

// POST /api/webhooks/purchase-invoices — inbound e-mail pushed by a service.
// The normal route is the mailbox reader (/api/cron/purchase-mailbox, IMAP);
// this endpoint is for an inbound-mail provider that posts the parsed message
// as JSON instead:
//
//   { "messageId": "<...>", "from": "billing@supplier.de", "subject": "Rechnung",
//     "attachments": [{ "filename": "RE-42.pdf", "contentType": "application/pdf",
//                       "content": "<base64>" }] }
//
// Each PDF/image attachment becomes a purchase invoice in "Te controleren"
// (source EMAIL); other attachments (signatures, logos in .gif, .ics, ...) are
// ignored. A retry of the same message is ignored per attachment.
//
// Auth: header `X-Api-Key: <PURCHASE_INBOUND_SECRET>`. Fails closed (503) when
// the secret is not set, so the endpoint is off until you configure it.

export const runtime = "nodejs";

const SECRET = process.env.PURCHASE_INBOUND_SECRET;

function authorized(req: Request): boolean {
  if (!SECRET) return false;
  const provided = req.headers.get("x-api-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const limit = rateLimit(`purchase-inbound:${clientIp(req)}`, 30);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  if (!SECRET) {
    return NextResponse.json(
      { ok: false, error: "Inbound e-mail is not configured (PURCHASE_INBOUND_SECRET)." },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key." }, { status: 401 });
  }
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "File storage (R2) is not configured." },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = purchaseInboundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Validation failed.", fields: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { messageId, from, subject, attachments } = parsed.data;
  const { created, skipped } = await receiveInboundFiles({
    messageRef: messageId ?? null,
    from,
    subject,
    files: attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      bytes: Buffer.from(a.content, "base64"),
    })),
  });

  return NextResponse.json({ ok: true, created, skipped }, { status: created.length ? 201 : 200 });
}
