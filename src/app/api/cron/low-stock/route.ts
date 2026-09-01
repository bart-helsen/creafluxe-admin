import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { notifyLowStock } from "@/server/notifications/notifyLowStock";

// GET/POST /api/cron/low-stock — the daily Railway cron that scans every active
// material and emails you what's at/below its reorder level (docs/11). Protected
// by a shared secret so only the scheduler can trigger it.
//
// Auth: send the secret as `X-Api-Key` (or `?key=`). It matches CRON_SECRET if
// set, otherwise falls back to INTAKE_API_KEY so a single secret works to start.
// Railway cron: configure a scheduled HTTP call to this path with the header.

export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.INTAKE_API_KEY;

function authorized(req: Request): boolean {
  if (!CRON_SECRET) return false; // fail closed
  const url = new URL(req.url);
  const provided =
    req.headers.get("x-api-key") ?? url.searchParams.get("key") ?? "";
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
    return NextResponse.json(
      { ok: false, error: "Invalid or missing key." },
      { status: 401 },
    );
  }

  try {
    const count = await notifyLowStock(); // all active low materials
    return NextResponse.json({ ok: true, lowMaterials: count });
  } catch (err) {
    console.error("[cron:low-stock] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Low-stock scan failed." },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
