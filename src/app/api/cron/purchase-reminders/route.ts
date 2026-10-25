import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { notifyStalePurchases } from "@/server/purchases/notifyStale";

// GET/POST /api/cron/purchase-reminders — nudges you by e-mail when purchase
// invoices sit in "Te controleren" or "Klaar voor Dexxter" for more than 7 days.
// Call it from a scheduler (Railway cron service, see README) once a day; it
// throttles itself, so calling it more often never sends more mail.
//
// Auth: same as the low-stock cron — `X-Api-Key` (or `?key=`) must match
// CRON_SECRET, falling back to INTAKE_API_KEY.

export const runtime = "nodejs";

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

  try {
    const listed = await notifyStalePurchases();
    return NextResponse.json({ ok: true, reminded: listed });
  } catch (err) {
    console.error("[cron:purchase-reminders] failed:", err);
    return NextResponse.json({ ok: false, error: "Reminder run failed." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
