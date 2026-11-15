# Invoice mail → admin.creafluxe.be

A Cloudflare Email Worker. Mail sent to a dedicated address (for example
`facturen@in.creafluxe.be`) arrives here. The Worker keeps the PDF and photo
attachments and posts them to the admin app (`/api/webhooks/purchase-invoices`).
Each file becomes a purchase invoice in **Te controleren**, prefilled from the
PDF text as with a manual upload.

- Mail forwarded "as attachment" (an `.eml` inside the mail) is unpacked too.
- Signature images, calendar invites and other files are ignored.
- Sending the same mail twice does not create duplicates.
- When nothing usable gets through, the mail bounces with the reason, for
  example "Geen PDF of foto van een factuur gevonden in deze mail" or
  "Admin-app antwoordde 401: …". A bounce means it is not in the app.
- Only senders in `ALLOWED_FROM` are accepted. Both the envelope sender and the
  From header are checked, so a manual forward and an automatic forwarding
  rule from your own mailbox both work. Keep the address to yourself.

The normal mailboxes (`@creafluxe.be` at easyhost, later Google) are not
touched: only the subdomain `in.creafluxe.be` gets Cloudflare's MX records.
When mail moves to Google, this keeps working unchanged. Only the forwarding
rule moves (step 5).

## Setup (about 20 minutes, once)

**1. Secret on Railway.** Generate a value:

```bash
node -e "console.log(require('crypto').randomBytes(33).toString('base64url'))"
```

Add it as `PURCHASE_INBOUND_SECRET` to the admin app's variables on Railway
(R2 must already be configured, as for uploads). Railway redeploys. Check:

```bash
curl -s -X POST https://admin.creafluxe.be/api/webhooks/purchase-invoices -H "Content-Type: application/json" -d "{}"
```

The response should say `Invalid or missing API key` (401). If it says
`not configured` (503), the variable isn't active yet.

**2. Deploy the Worker** (from this folder):

```bash
npm install
npm test
npx wrangler login
npx wrangler secret put PURCHASE_INBOUND_SECRET   # paste the same value
npm run deploy
```

Check `ALLOWED_FROM` in `wrangler.toml` first. It lists the addresses that
forward invoices to the Worker.

**3. Email Routing on the subdomain only.** Cloudflare dashboard →
creafluxe.be → Email Routing (under Email or Compute → Email Service) → Settings → **Subdomains** → add
`in.creafluxe.be`. Cloudflare adds MX and TXT records for `in.creafluxe.be`.

> ⚠️ Do **not** accept anything that adds Cloudflare MX records to
> `creafluxe.be` itself, or that deletes the existing `mx.mailprotect.be`
> records. That would stop the normal mailboxes from receiving mail. If
> Cloudflare won't allow the subdomain without enabling the root domain, stop
> there; there are other ways (a spare domain, or reading a mailbox over IMAP).
> Afterwards, check that the MX records of `creafluxe.be` still point to
> `mx.mailprotect.be`.

**4. Routing rule.** Email Routing → Routing rules → Create address:
`facturen@in.creafluxe.be` → action **Send to a Worker** →
`creafluxe-invoice-mail`.

**5. Test, then forward.** Forward one supplier invoice to
`facturen@in.creafluxe.be`. Within a minute it should be in admin →
Inkoopfacturen → Te controleren. Live log: `npm run tail`.

To make it automatic, add a rule in the mailbox where invoices arrive
(easyhost webmail now, Gmail filters after the move): mail from your
suppliers' billing addresses, with an attachment → forward to
`facturen@in.creafluxe.be`. Keep a copy in the mailbox.

## Changing it

- Allowed senders: edit `ALLOWED_FROM` in `wrangler.toml`, then `npm run deploy`.
  `@domain.be` allows a whole domain.
- `npm test` checks the parsing and the bounce rules, and checks the posted
  JSON against the app's own `purchaseInboundSchema`.
