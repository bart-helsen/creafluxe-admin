// EXAMPLE — Cloudflare Email Worker that forwards supplier invoices to the
// admin app. Not part of the Next.js build; deploy it separately with wrangler.
// Untested template: adapt and test it with one e-mail before relying on it.
//
// Flow: you forward a supplier e-mail to e.g. facturen@in.creafluxe.be →
// Cloudflare Email Routing hands it to this Worker → the Worker parses the MIME
// (postal-mime) and POSTs the attachments as JSON to the app, which creates one
// "Te controleren" purchase invoice per PDF/image.
//
// Setup (README → "Inkoopfacturen → Inbound e-mail"):
//   npm create cloudflare@latest invoice-mail -- --type hello-world
//   cd invoice-mail && npm install postal-mime
//   copy this file to src/index.js
//   npx wrangler secret put PURCHASE_INBOUND_SECRET   (same value as on Railway)
//   in wrangler.toml: [vars] APP_URL = "https://admin.creafluxe.be"
//                     ALLOWED_FROM = "bart.helsen@creafluxe.be"
//   npx wrangler deploy, then route the address to this Worker in
//   Cloudflare → Email → Email Routing → Routing rules.

import PostalMime from "postal-mime";

function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export default {
  async email(message, env) {
    // Only accept mail forwarded by you — the address is not a public inbox.
    const allowed = (env.ALLOWED_FROM || "").toLowerCase().split(",").map((s) => s.trim());
    if (allowed.length && allowed[0] && !allowed.includes(message.from.toLowerCase())) {
      message.setReject("Sender not allowed");
      return;
    }

    const email = await new PostalMime().parse(message.raw);
    const attachments = (email.attachments || []).map((a) => ({
      filename: a.filename || "bijlage",
      contentType: a.mimeType || "",
      content: toBase64(a.content),
    }));

    const res = await fetch(`${env.APP_URL}/api/webhooks/purchase-invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.PURCHASE_INBOUND_SECRET },
      body: JSON.stringify({
        messageId: email.messageId,
        from: email.from?.address,
        subject: email.subject,
        attachments,
      }),
    });
    if (!res.ok) {
      // Bounce so you notice; Cloudflare will report the failure to the sender (you).
      message.setReject(`Admin app answered ${res.status}`);
    }
  },
};
