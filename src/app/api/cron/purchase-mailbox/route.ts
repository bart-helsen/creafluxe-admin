import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isR2Configured } from "@/lib/r2";
import { describeRun, mailboxConfig, pollPurchaseMailbox } from "@/server/purchases/mailbox";

// GET/POST /api/cron/purchase-mailbox — reads the purchase-invoice mailbox
// (PURCHASE_IMAP_*) and turns every PDF/photo into a "Te controleren" invoice.
// Call it from a scheduler every 15 minutes (Railway cron service, see README).
// Reading the same mail twice is harmless.
//
// Auth: same as the other crons — `X-Api-Key` (or `?key=`) must match
// CRON_SECRET, falling back to INTAKE_API_KEY.

export const runtime = "nodejs";
export const maxDuration = 120;

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.INTAKE_API_KEY;

function authorized(req: Request): boolean {
  if (!CRON_SECRET) return false; // fail closed
  const url = new URL(req.url);
  const provided = req.headers.get("x-api-key") ?? url.searchParams.get("key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(CRON_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET (or INTAKE_API_KEY) is not configured." },
      { status: 500 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing key." }, { status: 401 });
  }
  const cfg = mailboxConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "Mailbox not configured (PURCHASE_IMAP_HOST/USER/PASSWORD)." },
      { status: 503 },
    );
  }
  if (!isR2Configured()) {
    return NextResponse.json({ ok: false, error: "File storage (R2) is not configured." }, { status: 501 });
  }

  try {
    const run = await pollPurchaseMailbox(cfg);
    if (run.created) {
      revalidatePath("/purchases");
      revalidatePath("/");
    }
    return NextResponse.json({ ok: true, summary: describeRun(run), ...run });
  } catch (err) {
    console.error("[cron:purchase-mailbox] failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Mailbox run failed: ${message}` }, { status: 502 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
