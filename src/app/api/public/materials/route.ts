import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { getPublicMaterials } from "@/server/materials/publicMaterials";

// GET /api/public/materials — the published material samples for the website's
// "Materialen" section. Read-only and public by design (it only ever contains
// what you switched on with "Toon op de website"), so no API key. Cached for a
// few minutes so the website and CDNs don't hit the database on every view.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(req: Request) {
  const limit = rateLimit(`public-materials:${clientIp(req)}`, 120);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests." },
      {
        status: 429,
        headers: { ...CORS, "Retry-After": String(limit.retryAfter) },
      },
    );
  }

  try {
    const materials = await getPublicMaterials();
    return NextResponse.json(
      { ok: true, materials },
      {
        headers: {
          ...CORS,
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("[public-materials] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not load materials." },
      { status: 500, headers: CORS },
    );
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
