import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { intakeSchema } from "@/lib/validation";
import { createOrder } from "@/server/orders/createOrder";
import { createRequestFromIntake } from "@/server/requests/createRequest";

// POST /api/orders/intake — the single endpoint that replaces the order emails
// (docs/04 §A, Flow 1). The website posts the cart/design request here with a
// shared X-Api-Key. We validate, then:
//   - type WEBSHOP → an Order (re-priced server-side, draft invoice, e-mail)
//   - type CUSTOM  → a custom request (Aanvraag) — no order until you've made
//                    an offer and the customer accepted it.
// The URL stays the same so the website needs no change.

// This route uses Prisma/Node APIs — force the Node.js runtime, not Edge.
export const runtime = "nodejs";

export async function POST(req: Request) {
  // Rate limit first (cheap, before any work).
  const limit = rateLimit(`intake:${clientIp(req)}`);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  // Shared-secret auth.
  const auth = checkApiKey(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.message },
      { status: auth.status },
    );
  }

  // Parse + validate the body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Validation failed.", fields: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    if (parsed.data.type === "CUSTOM") {
      const result = await createRequestFromIntake(parsed.data);
      return NextResponse.json(
        {
          ok: true,
          kind: "request",
          requestId: result.requestId,
          requestNumber: result.requestNumber,
          duplicate: result.duplicate,
        },
        { status: result.duplicate ? 200 : 201 },
      );
    }

    const result = await createOrder(parsed.data);
    return NextResponse.json(
      {
        ok: true,
        kind: "order",
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        duplicate: result.duplicate,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    console.error("[intake] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not process the order." },
      { status: 500 },
    );
  }
}
