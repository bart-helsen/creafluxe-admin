import { describe, it, expect, vi } from "vitest";
import { handle, buildPayload, senderAllowed, parseList } from "../src/index.js";
import { purchaseInboundSchema } from "@/lib/validation";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const BIG_PNG = Buffer.alloc(30 * 1024, 7);
const SMALL_PNG = Buffer.alloc(2 * 1024, 7);

function b64(buf) {
  return buf.toString("base64").replace(/.{76}/g, "$&\r\n");
}

function part(filename, type, buf) {
  return [
    `Content-Type: ${type}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64(buf),
  ].join("\r\n");
}

function mail({ from = "Bart <bart.helsen@creafluxe.be>", subject = "Fwd: Rechnung RE-42", id = "<m1@test>", parts = [] }) {
  const boundary = "BOUNDARY" + Math.random().toString(36).slice(2);
  return [
    `From: ${from}`,
    "To: facturen@in.creafluxe.be",
    `Subject: ${subject}`,
    `Message-ID: ${id}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Zie bijlage.",
    ...parts.flatMap((p) => [`--${boundary}`, p]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

const env = {
  APP_URL: "https://admin.creafluxe.be/",
  PURCHASE_INBOUND_SECRET: "s3cret",
  ALLOWED_FROM: "bart.helsen@creafluxe.be",
};

function okFetch(body = { ok: true, created: ["c1"], skipped: [] }, status = 201) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("sender allowlist", () => {
  it("accepts envelope or header match, exact or @domain", () => {
    const list = parseList(" Bart.Helsen@creafluxe.be , @kbc.be ");
    expect(senderAllowed(list, "bart.helsen@creafluxe.be", "x@supplier.de")).toBe(true);
    expect(senderAllowed(list, "srs0=abc@mailprotect.be", "bart.helsen@creafluxe.be")).toBe(true);
    expect(senderAllowed(list, "a@b.c", "noreply@kbc.be")).toBe(true);
    expect(senderAllowed(list, "spam@evil.com", "spam@evil.com")).toBe(false);
    expect(senderAllowed([], "anyone@x.y", null)).toBe(true);
  });
});

describe("handle", () => {
  it("posts a PDF in the shape the app's webhook accepts", async () => {
    const fetchImpl = okFetch();
    const raw = mail({ parts: [part("RE-42.pdf", "application/pdf", PDF)] });
    const reason = await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl });
    expect(reason).toBeNull();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://admin.creafluxe.be/api/webhooks/purchase-invoices");
    expect(init.headers["X-Api-Key"]).toBe("s3cret");
    const body = JSON.parse(init.body);
    const parsed = purchaseInboundSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.messageId).toBe("<m1@test>");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe("RE-42.pdf");
    expect(Buffer.from(body.attachments[0].content, "base64").equals(PDF)).toBe(true);
  });

  it("finds the PDF inside a mail forwarded as attachment (.eml)", async () => {
    const inner = mail({ from: "billing@supplier.de", id: "<inner@test>", parts: [part("Rechnung.pdf", "application/pdf", PDF)] });
    const outer = [
      'Content-Type: message/rfc822; name="Rechnung.eml"',
      'Content-Disposition: attachment; filename="Rechnung.eml"',
      "",
      inner,
    ].join("\r\n");
    const fetchImpl = okFetch();
    const reason = await handle({ raw: mail({ parts: [outer] }), envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl });
    expect(reason).toBeNull();
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.attachments.map((a) => a.filename)).toEqual(["Rechnung.pdf"]);
    expect(Buffer.from(body.attachments[0].content, "base64").equals(PDF)).toBe(true);
  });

  it("keeps photos, drops signature images and other files", async () => {
    const { payload } = await buildPayload(
      mail({
        parts: [
          part("logo.png", "image/png", SMALL_PNG),
          part("bon.png", "image/png", BIG_PNG),
          part("invite.ics", "text/calendar", Buffer.from("BEGIN:VCALENDAR")),
          part("scan.PDF", "application/octet-stream", PDF),
        ],
      }),
    );
    expect(payload.attachments.map((a) => [a.filename, a.contentType])).toEqual([
      ["bon.png", "image/png"],
      ["scan.PDF", "application/pdf"],
    ]);
  });

  it("bounces a stranger without calling the app", async () => {
    const fetchImpl = okFetch();
    const raw = mail({ from: "spam@evil.com", parts: [part("x.pdf", "application/pdf", PDF)] });
    const reason = await handle({ raw, envelopeFrom: "spam@evil.com", env, fetchImpl });
    expect(reason).toMatch(/niet toegestaan/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets an automatic forward through (envelope = Bart, From = supplier)", async () => {
    const raw = mail({ from: "billing@supplier.de", parts: [part("x.pdf", "application/pdf", PDF)] });
    expect(await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl: okFetch() })).toBeNull();
  });

  it("bounces a mail without an invoice file", async () => {
    const fetchImpl = okFetch();
    const reason = await handle({ raw: mail({ parts: [] }), envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl });
    expect(reason).toMatch(/Geen PDF/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounces with the app's error when it refuses", async () => {
    const fetchImpl = okFetch({ ok: false, error: "Invalid or missing API key." }, 401);
    const raw = mail({ parts: [part("x.pdf", "application/pdf", PDF)] });
    const reason = await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl });
    expect(reason).toBe("Admin-app antwoordde 401: Invalid or missing API key.");
  });

  it("bounces when the app is unreachable", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("timeout"); });
    const raw = mail({ parts: [part("x.pdf", "application/pdf", PDF)] });
    expect(await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl })).toMatch(/niet bereikbaar/);
  });

  it("stays silent on a repeat of an already received mail", async () => {
    const fetchImpl = okFetch({ ok: true, created: [], skipped: [{ filename: "x.pdf", reason: "already received" }] }, 200);
    const raw = mail({ parts: [part("x.pdf", "application/pdf", PDF)] });
    expect(await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl })).toBeNull();
  });

  it("bounces when the app stored nothing", async () => {
    const fetchImpl = okFetch({ ok: true, created: [], skipped: [{ filename: "x.pdf", reason: "could not be stored" }] }, 200);
    const raw = mail({ parts: [part("x.pdf", "application/pdf", PDF)] });
    expect(await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl })).toMatch(/could not be stored/);
  });

  it("reads the raw mail as a stream, like Cloudflare passes it", async () => {
    const raw = new Response(mail({ parts: [part("x.pdf", "application/pdf", PDF)] })).body;
    expect(await handle({ raw, envelopeFrom: "bart.helsen@creafluxe.be", env, fetchImpl: okFetch() })).toBeNull();
  });
});
