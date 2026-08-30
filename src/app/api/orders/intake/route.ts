import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { intakeSchema } from "@/lib/validation";
import { createOrder } from "@/server/orders/createOrder";

// POST /api/orders/intake — the single endpoint that replaces the order emails
// (docs/04 §A, Flow 1). The website posts the cart/design request here with a
// shared X-Api-Key. We validate, re-price server-side, persist, and fire the
// automation chain (draft invoice + notification).

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
    const result = await createOrder(parsed.data);
    return NextResponse.json(
      {
        ok: true,
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
