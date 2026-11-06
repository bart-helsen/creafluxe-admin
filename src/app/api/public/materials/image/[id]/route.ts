import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isR2Configured, getObjectBytes } from "@/lib/r2";
import { findPublicSample } from "@/server/materials/publicMaterials";

// GET /api/public/materials/image/<sampleId> — streams a published sample photo
// from R2. The bucket stays private: only photos that are active AND whose
// material/group is switched on for the website can be fetched here. The URL
// carries a ?v=<updatedAt> version, so the response can be cached "forever".

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limit = rateLimit(`public-material-image:${clientIp(req)}`, 600);
  if (!limit.ok) {
    return new Response("Too many requests.", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter) },
    });
  }
  if (!isR2Configured()) {
    return new Response("Storage not configured.", { status: 501 });
  }

  const { id } = await params;
  const sample = await findPublicSample(id);
  if (!sample) return new Response("Not found.", { status: 404 });

  try {
    const bytes = await getObjectBytes(sample.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": sample.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[public-material-image] failed:", err);
    return new Response("Could not load image.", { status: 502 });
  }
}
