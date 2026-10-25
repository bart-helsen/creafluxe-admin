import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { purchaseInboundSchema } from "@/lib/validation";
import { isR2Configured, resolvePurchaseMime, MAX_PURCHASE_BYTES } from "@/lib/r2";
import { receivePurchaseInvoice } from "@/server/purchases/purchaseInvoices";

// POST /api/webhooks/purchase-invoices — inbound e-mail. Whatever receives mail
// for your dedicated address (a Cloudflare Email Worker, or an inbound-mail
// provider) posts the parsed message here as JSON:
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
  const notes = [from && `Van: ${from}`, subject && `Onderwerp: ${subject}`].filter(Boolean).join("\n") || null;

  const created: string[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const att of attachments) {
    const mimeType = resolvePurchaseMime(att.filename, att.contentType);
    if (!mimeType) {
      skipped.push({ filename: att.filename, reason: "unsupported type" });
      continue;
    }
    const bytes = Buffer.from(att.content, "base64");
    if (bytes.length === 0 || bytes.length > MAX_PURCHASE_BYTES) {
      skipped.push({ filename: att.filename, reason: "empty or larger than 10 MB" });
      continue;
    }
    // Tiny inline images are e-mail signatures/logos, not invoices.
    if (mimeType !== "application/pdf" && bytes.length < 20 * 1024) {
      skipped.push({ filename: att.filename, reason: "small inline image" });
      continue;
    }

    const sourceRef = messageId ? `${messageId}#${att.filename}`.slice(0, 700) : null;
    if (sourceRef) {
      const seen = await prisma.purchaseInvoice.findFirst({
        where: { sourceRef },
        select: { id: true },
      });
      if (seen) {
        skipped.push({ filename: att.filename, reason: "already received" });
        continue;
      }
    }

    try {
      const { id } = await receivePurchaseInvoice({
        file: { bytes, fileName: att.filename, mimeType },
        source: "EMAIL",
        sourceRef,
        notes,
      });
      created.push(id);
    } catch (err) {
      console.error("[webhook:purchase-invoices] attachment failed:", att.filename, err);
      skipped.push({ filename: att.filename, reason: "could not be stored" });
    }
  }

  return NextResponse.json({ ok: true, created, skipped }, { status: created.length ? 201 : 200 });
}
