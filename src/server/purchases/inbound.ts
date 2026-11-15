import PostalMime, { type Email } from "postal-mime";
import { prisma } from "@/lib/db";
import { MAX_PURCHASE_BYTES, resolvePurchaseMime } from "@/lib/r2";
import { receivePurchaseInvoice } from "@/server/purchases/purchaseInvoices";

// Purchase invoices that arrive by e-mail — shared by the mailbox reader
// (server/purchases/mailbox.ts) and the inbound webhook. One mail can hold
// several invoices; each PDF/photo becomes its own "Te controleren" invoice.

export interface InboundFile {
  filename: string;
  /** What the mail said; resolvePurchaseMime decides what we accept. */
  contentType: string;
  bytes: Buffer;
}

export interface InboundResult {
  created: string[];
  skipped: { filename: string; reason: SkipReason }[];
}

export type SkipReason =
  | "unsupported type"
  | "empty or larger than 10 MB"
  | "small inline image"
  | "already received"
  | "could not be stored";

/** Signature images and logos are small; real photos of invoices are not. */
const MIN_IMAGE_BYTES = 20 * 1024;
/** A mail forwarded "as attachment" inside another one, and so on. */
const MAX_NESTING = 3;

function isEmbeddedMail(
  mimeType: string | undefined,
  filename: string | null | undefined,
): boolean {
  return (mimeType ?? "").toLowerCase() === "message/rfc822" || /\.eml$/i.test(filename ?? "");
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === "string") return Buffer.from(content, "utf8");
  return Buffer.from(content instanceof Uint8Array ? content : new Uint8Array(content));
}

export function parseMail(raw: Buffer | Uint8Array | string): Promise<Email> {
  return PostalMime.parse(raw, { forceRfc822Attachments: true });
}

/**
 * All attachments of a parsed mail, including those inside mails that were
 * forwarded as an attachment (.eml). Filtering happens in receiveInboundFiles.
 */
export async function collectAttachments(email: Email, depth = 0): Promise<InboundFile[]> {
  const out: InboundFile[] = [];
  for (const att of email.attachments ?? []) {
    if (isEmbeddedMail(att.mimeType, att.filename)) {
      if (depth < MAX_NESTING) {
        out.push(...(await collectAttachments(await parseMail(toBuffer(att.content)), depth + 1)));
      }
      continue;
    }
    out.push({
      filename: (att.filename || "bijlage").slice(0, 255),
      contentType: att.mimeType ?? "",
      bytes: toBuffer(att.content),
    });
  }
  return out;
}

/** "a@x.be, @y.de" → ["a@x.be", "@y.de"] (lower case). */
export function parseAddressList(value: string | undefined | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is one of these addresses allowed? Entries are full addresses or "@domain".
 * An empty list allows everyone.
 */
export function senderAllowed(
  allowed: string[],
  addresses: (string | null | undefined)[],
): boolean {
  if (!allowed.length) return true;
  return addresses.some((address) => {
    if (!address) return false;
    const a = address.toLowerCase();
    return allowed.some((entry) => (entry.startsWith("@") ? a.endsWith(entry) : a === entry));
  });
}

/** Why a file is not an invoice to store, or null when it is. */
export function rejectReason(file: InboundFile): SkipReason | null {
  const mimeType = resolvePurchaseMime(file.filename, file.contentType);
  if (!mimeType) return "unsupported type";
  if (file.bytes.length === 0 || file.bytes.length > MAX_PURCHASE_BYTES)
    return "empty or larger than 10 MB";
  if (mimeType !== "application/pdf" && file.bytes.length < MIN_IMAGE_BYTES)
    return "small inline image";
  return null;
}

/**
 * Store each usable file as a purchase invoice (source EMAIL). The same file of
 * the same mail is only stored once, so reading a mail twice is harmless.
 */
export async function receiveInboundFiles(params: {
  messageRef: string | null;
  from?: string | null;
  subject?: string | null;
  files: InboundFile[];
}): Promise<InboundResult> {
  const { messageRef, from, subject, files } = params;
  const notes =
    [from && `Van: ${from}`, subject && `Onderwerp: ${subject}`].filter(Boolean).join("\n") || null;
  const result: InboundResult = { created: [], skipped: [] };

  for (const file of files) {
    const reason = rejectReason(file);
    if (reason) {
      result.skipped.push({ filename: file.filename, reason });
      continue;
    }
    const mimeType = resolvePurchaseMime(file.filename, file.contentType)!;

    const sourceRef = messageRef ? `${messageRef}#${file.filename}`.slice(0, 700) : null;
    if (sourceRef) {
      const seen = await prisma.purchaseInvoice.findFirst({
        where: { sourceRef },
        select: { id: true },
      });
      if (seen) {
        result.skipped.push({ filename: file.filename, reason: "already received" });
        continue;
      }
    }

    try {
      const { id } = await receivePurchaseInvoice({
        file: { bytes: file.bytes, fileName: file.filename, mimeType },
        source: "EMAIL",
        sourceRef,
        notes,
      });
      result.created.push(id);
    } catch (err) {
      console.error("[purchases:inbound] attachment failed:", file.filename, err);
      result.skipped.push({ filename: file.filename, reason: "could not be stored" });
    }
  }
  return result;
}

/** What to do with a mail in the mailbox after trying to receive it. */
export type MailOutcome =
  | { action: "done" } // stored (or stored before): move it to the done folder
  | { action: "retry"; reason: string } // temporary problem: leave it, try next run
  | { action: "flag"; reason: string }; // nothing usable: flag it for you to look at

const REASON_NL: Record<SkipReason, string> = {
  "unsupported type": "geen PDF of foto",
  "empty or larger than 10 MB": "leeg of groter dan 10 MB",
  "small inline image": "enkel kleine afbeeldingen (logo's)",
  "already received": "al ontvangen",
  "could not be stored": "kon niet opgeslagen worden",
};

export function mailOutcome(result: InboundResult): MailOutcome {
  const reasons = result.skipped.map((s) => s.reason);
  // Retry the whole mail; files stored already are skipped as "already received".
  if (reasons.includes("could not be stored")) {
    return { action: "retry", reason: REASON_NL["could not be stored"] };
  }
  if (result.created.length) return { action: "done" };
  if (reasons.length && reasons.every((r) => r === "already received")) return { action: "done" };
  const unique = [...new Set(reasons)].map((r) => REASON_NL[r]);
  return { action: "flag", reason: unique.length ? unique.join(", ") : "geen bijlagen" };
}
