// Cloudflare Email Worker: supplier invoices by e-mail → admin.creafluxe.be.
//
// Flow: a mail arrives at the dedicated address (e.g. facturen@in.creafluxe.be)
// → Cloudflare Email Routing hands it to this Worker → the Worker parses the
// MIME, keeps the PDF/photo attachments (also those inside a mail forwarded
// "as attachment" (.eml)) and POSTs them to /api/webhooks/purchase-invoices.
// The app creates one "Te controleren" purchase invoice per file.
//
// When nothing usable gets through, the Worker rejects the mail, so the sender
// (you, when you forward) gets a bounce that says why. Setup: README.md here.

import PostalMime from "postal-mime";

/** Same types the app accepts (src/lib/r2.ts → ALLOWED_PURCHASE_MIME). */
const INVOICE_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const INVOICE_EXT = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const MAX_BYTES = 10 * 1024 * 1024; // the app's limit per file
const MAX_FILES = 20; // the app's limit per mail
const MAX_NESTING = 3; // forwarded-as-attachment inside forwarded-as-attachment ...

/** "a@x.be, @y.de" → ["a@x.be", "@y.de"] */
export function parseList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matches(address, entry) {
  if (!address) return false;
  const a = address.toLowerCase();
  return entry.startsWith("@") ? a.endsWith(entry) : a === entry;
}

/**
 * Is this sender allowed? Checks the envelope sender and the From header, so
 * both a manual forward (From = you) and an automatic forwarding rule (envelope
 * = your mailbox, From = the supplier) get through. An empty list allows all.
 */
export function senderAllowed(allowed, envelopeFrom, headerFrom) {
  if (!allowed.length) return true;
  return allowed.some((entry) => matches(envelopeFrom, entry) || matches(headerFrom, entry));
}

/** The type the app will accept for this file, or null. */
export function invoiceMime(filename, mimeType) {
  const reported = String(mimeType || "").toLowerCase();
  if (INVOICE_MIME.has(reported)) return reported;
  const ext = String(filename || "").split(".").pop().toLowerCase();
  return INVOICE_EXT[ext] ?? null;
}

function isEmbeddedMail(att) {
  return String(att.mimeType || "").toLowerCase() === "message/rfc822" || /\.eml$/i.test(att.filename || "");
}

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Walk the mail (and mails attached to it) and collect invoice files. */
async function collect(parsed, depth, out) {
  for (const att of parsed.attachments || []) {
    if (isEmbeddedMail(att)) {
      if (depth < MAX_NESTING) {
        const inner = await PostalMime.parse(att.content, { forceRfc822Attachments: true });
        await collect(inner, depth + 1, out);
      }
      continue;
    }
    const mime = invoiceMime(att.filename, att.mimeType);
    if (!mime) continue;
    const size = att.content?.byteLength ?? 0;
    if (!size) continue;
    // Small images are signatures and logos; the app skips them too.
    if (mime !== "application/pdf" && size < 20 * 1024) continue;
    if (size > MAX_BYTES) {
      out.tooLarge.push(att.filename || "bijlage");
      continue;
    }
    out.files.push({
      filename: (att.filename || `bijlage.${mime.split("/")[1]}`).slice(0, 255),
      contentType: mime,
      content: toBase64(att.content),
    });
  }
}

/** Parse a raw mail into the JSON the app's webhook expects. */
export async function buildPayload(raw) {
  const email = await PostalMime.parse(raw, { forceRfc822Attachments: true });
  const out = { files: [], tooLarge: [] };
  await collect(email, 0, out);
  return {
    payload: {
      messageId: email.messageId || null,
      from: email.from?.address || null,
      subject: email.subject || null,
      attachments: out.files.slice(0, MAX_FILES),
    },
    tooLarge: out.tooLarge,
    extraFiles: Math.max(0, out.files.length - MAX_FILES),
  };
}

/**
 * Handle one mail. Returns null when all is well, or the reason to bounce it.
 * Kept separate from the Worker entry point so it can be tested.
 */
export async function handle({ raw, envelopeFrom, env, fetchImpl = fetch }) {
  const { payload, tooLarge, extraFiles } = await buildPayload(raw);

  if (!senderAllowed(parseList(env.ALLOWED_FROM), envelopeFrom, payload.from)) {
    return "Afzender niet toegestaan voor dit adres.";
  }
  if (!payload.attachments.length) {
    return tooLarge.length
      ? `Bijlage groter dan 10 MB: ${tooLarge.join(", ")}.`
      : "Geen PDF of foto van een factuur gevonden in deze mail.";
  }

  let res;
  try {
    res = await fetchImpl(`${String(env.APP_URL).replace(/\/$/, "")}/api/webhooks/purchase-invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.PURCHASE_INBOUND_SECRET || "" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return `Admin-app niet bereikbaar (${err?.message || err}). Stuur de mail later opnieuw.`;
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON; fall through with the status code
  }
  if (!res.ok) {
    const why = body?.error ? `: ${String(body.error).replace(/\.$/, "")}` : "";
    return `Admin-app antwoordde ${res.status}${why}.`;
  }

  const created = body?.created?.length ?? 0;
  const skipped = (body?.skipped || []).filter((s) => s.reason !== "already received");
  const problems = [
    ...skipped.map((s) => `${s.filename} (${s.reason})`),
    ...tooLarge.map((f) => `${f} (groter dan 10 MB)`),
    ...(extraFiles ? [`${extraFiles} bijlage(n) boven de limiet van ${MAX_FILES}`] : []),
  ];
  // Nothing new and something went wrong: tell the sender. A pure repeat of
  // a mail that was already received is fine and stays silent.
  if (!created && problems.length) {
    return `Geen factuur aangemaakt: ${problems.join("; ")}.`;
  }
  if (problems.length) {
    console.warn("[invoice-mail] partly processed:", problems.join("; "));
  }
  return null;
}

export default {
  async email(message, env) {
    const reason = await handle({ raw: message.raw, envelopeFrom: message.from, env });
    if (reason) {
      console.warn("[invoice-mail] rejected:", reason);
      message.setReject(reason);
    }
  },
};
