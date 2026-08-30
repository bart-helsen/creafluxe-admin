import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { presignSchema } from "@/lib/validation";
import {
  isR2Configured,
  presignUpload,
  buildCustomKey,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
} from "@/lib/r2";

// POST /api/uploads/presign — returns a short-lived presigned R2 URL so a
// design file can be uploaded straight to storage without routing bytes through
// the app (docs/04 §A). Protected by the same X-Api-Key as intake.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limit = rateLimit(`presign:${clientIp(req)}`, 120);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const auth = checkApiKey(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.message },
      { status: auth.status },
    );
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
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Validation failed.", fields: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { fileName, mimeType, sizeBytes } = parsed.data;
  if (!ALLOWED_UPLOAD_MIME.has(mimeType)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported file type: ${mimeType}.` },
      { status: 422 },
    );
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: "File exceeds the 10 MB limit." },
      { status: 422 },
    );
  }

  const storageKey = buildCustomKey(fileName);
  const uploadUrl = await presignUpload(storageKey, mimeType);
  return NextResponse.json({ uploadUrl, storageKey, expiresIn: 600 });
}
