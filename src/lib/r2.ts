import { randomBytes } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 adapter (S3-compatible). Files (design masters + customer
// uploads + invoice PDFs) live in R2; the database stores only the storage key.
// The app builds short-lived presigned URLs on demand so bytes never route
// through the app server. See docs/02 (hosting) and docs/03 (DesignAsset).
//
// R2 is optional in local development: if the credentials are not set the
// presign endpoint returns a clear 501 and the notification email omits file
// links, so the rest of Phase 1 (intake, orders, invoices) works without it.

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET ?? "creafluxe-designs";

export function isR2Configured(): boolean {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
    );
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID!,
        secretAccessKey: SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedClient;
}

/** Allowed upload MIME types (matches the current website handler). */
export const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "image/svg+xml",
  "application/postscript", // .ai / .eps
  "image/vnd.dxf",
  "application/dxf",
  "image/vnd.dwg",
  "application/acad",
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Build a collision-proof storage key for a customer upload. */
export function buildCustomKey(fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `custom/${Date.now()}-${randomBytes(6).toString("hex")}-${safe}`;
}

/** Build a collision-proof storage key for a maintained master/library file. */
export function buildMasterKey(fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `master/${Date.now()}-${randomBytes(6).toString("hex")}-${safe}`;
}

/** A short-lived URL the browser/site can PUT a file to. */
export async function presignUpload(
  storageKey: string,
  mimeType: string,
  expiresIn = 600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
    ContentType: mimeType,
  });
  return getSignedUrl(client(), command, { expiresIn });
}

/** A short-lived URL to download/preview a stored file. */
export async function presignDownload(
  storageKey: string,
  expiresIn = 600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
  });
  return getSignedUrl(client(), command, { expiresIn });
}

/** Upload bytes directly (used for generated invoice PDFs). */
export async function putObject(
  storageKey: string,
  body: Buffer,
  mimeType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: mimeType,
    }),
  );
}

/** Fetch a stored object's bytes (used to stream an invoice PDF). */
export async function getObjectBytes(storageKey: string): Promise<Buffer> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
