import { timingSafeEqual } from "node:crypto";

// Shared-secret auth for the machine endpoints the website calls (docs/04).
// The site sends `X-Api-Key: <INTAKE_API_KEY>`; we compare it to the env secret
// in constant time so the check can't be timing-probed.

const INTAKE_API_KEY = process.env.INTAKE_API_KEY;

export type ApiKeyResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; message: string };

export function checkApiKey(req: Request): ApiKeyResult {
  if (!INTAKE_API_KEY) {
    // Fail closed: an unset secret means the endpoint is misconfigured, not open.
    return {
      ok: false,
      status: 500,
      message: "INTAKE_API_KEY is not configured on the server.",
    };
  }
  const provided = req.headers.get("x-api-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(INTAKE_API_KEY);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Invalid or missing API key." };
  }
  return { ok: true };
}
