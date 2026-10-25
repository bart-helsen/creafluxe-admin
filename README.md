# Creafluxe Admin

Internal administration software for Creafluxe — order intake, tracking, and
invoicing. Built with **Next.js (App Router) + TypeScript + Prisma + PostgreSQL**,
following the blueprint in `../administration/`.

This repository has **Phase 0 + Phase 1** implemented. Phase 0 is the running,
protected skeleton (login + schema). **Phase 1** adds the core the business runs
on: the order-intake API, the New/Open/Finished orders screens, automatic draft
invoices with a PDF, gapless invoice numbering, the design-file bundling, and
the new-order notification email. See `../administration/docs/07-roadmap.md`.

---

## What's in the box

```
creafluxe-admin/
├── prisma/schema.prisma        # the full data model (from the blueprint)
├── src/
│   ├── app/
│   │   ├── (dashboard)/        # protected admin UI (layout + home)
│   │   ├── login/              # login page
│   │   ├── api/auth/[...nextauth]/  # Auth.js endpoints
│   │   └── globals.css
│   ├── lib/
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── auth.ts             # Auth.js (Node runtime): Credentials + Prisma
│   │   ├── auth.config.ts      # Auth.js (edge-safe): route protection
│   │   ├── actions.ts          # login / logout server actions
│   │   └── validation.ts       # Zod schemas
│   ├── components/             # LoginForm, SignOutButton
│   ├── types/next-auth.d.ts    # session/JWT type augmentation
│   └── middleware.ts           # guards every route
├── scripts/create-admin.ts     # one-off: create your login
├── .env.example                # every variable you need
└── package.json
```

Login uses **Auth.js (next-auth v5)** with an email + password (Credentials)
provider. Passwords are hashed with **bcrypt** — plaintext is never stored.

---

## Prerequisites

- **Node.js 20 or newer** (`node --version`).
- A **PostgreSQL** database. You already have one on **Railway** — you'll paste
  its connection string in step 2.

---

## Run it locally (about 10 minutes)

### 1. Install dependencies

```bash
cd creafluxe-admin
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`:

- `DATABASE_URL` — from Railway: open your **Postgres** service → **Connect** →
  copy the **Public Network** connection URL (works from your laptop).
- `AUTH_SECRET` — generate one:

  ```bash
  npx auth secret
  ```

  (or `openssl rand -base64 33`). Paste the result.
- Leave `AUTH_TRUST_HOST="true"` as-is.

### 3. Create the database tables

```bash
npx prisma migrate dev --name init
```

This reads `prisma/schema.prisma` and creates every table. You can inspect the
result any time with:

```bash
npx prisma studio
```

### 4. Create your admin login

```bash
npx tsx scripts/create-admin.ts bart@creafluxe.be "a-strong-password" "Bart Helsen"
```

Choose a real, strong password (min. 8 characters). Re-running this for the same
email resets the password.

### 5. Start the app

```bash
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to **/login**; sign in with
the credentials from step 4 and you'll land on the empty dashboard. ✅ Phase 0
done locally.

---

## Deploy to Railway

The website stays on EasyHost; only this admin app goes to Railway.

1. **Push this folder to a Git repository** (GitHub) and, in Railway, **New →
   Deploy from GitHub repo**, pointing at it. Put it in the **same Railway
   project** as your Postgres so they share a private network.

2. **Set variables** on the app service (Railway → your service → *Variables*):

   | Variable          | Value                                                  |
   | ----------------- | ------------------------------------------------------ |
   | `DATABASE_URL`    | the Postgres **private** URL (`${{Postgres.DATABASE_URL}}`) |
   | `AUTH_SECRET`     | the same secret you generated (or a fresh one)         |
   | `AUTH_TRUST_HOST` | `true`                                                 |

   > **Private vs public URL — and egress cost.** The private
   > (`postgres.railway.internal`) URL is free; traffic over the **public** URL
   > is billed as network egress (a few cents/GB). So the *running app* should
   > use the **private** URL. The catch: the private network is not reachable
   > during the build, and takes a few seconds to come up after a container
   > boots — so do **not** connect to it at startup (that causes
   > `P1001: Can't reach database server`). We handle that by NOT running
   > migrations at startup (see step 4); the app only queries the DB when a
   > request arrives, by which point the private network is up.

3. **Build & start commands** (Railway → *Settings*):
   - Build: `npm run build`  ← must NOT touch the database (no migrations here).
   - Start: `npm run start`  ← no migration step, so nothing connects at boot.

4. **Run migrations from your laptop** (over the public URL), not on Railway.
   Migrations are infrequent (only when the schema changes) and move tiny
   amounts of data, so the egress is negligible:

   ```bash
   # Point DATABASE_URL at the PUBLIC url just for this command.
   # Public url: Postgres service → Variables → DATABASE_PUBLIC_URL
   #   (enable Settings → Networking → Public Networking if it's not shown).
   DATABASE_URL="postgresql://postgres:...@<host>.proxy.rlwy.net:PORT/railway" \
     npx prisma migrate deploy
   ```

   Check what's applied with `npx prisma migrate status` (same public URL).
   Make sure the `prisma/migrations/` folder is committed to git.

5. **First admin on Railway:** create your login in the Railway database by
   running the create-admin script from your laptop with `DATABASE_URL`
   pointed at the **public** Railway URL (same as the migration step above):

   ```bash
   DATABASE_URL="postgresql://postgres:...@<host>.proxy.rlwy.net:PORT/railway" \
     npx tsx scripts/create-admin.ts bart@creafluxe.be "a-strong-password" "Bart Helsen"
   ```

6. **Custom domain (optional now):** add `admin.creafluxe.be` in Railway and a
   CNAME in Cloudflare. Consider putting it behind Cloudflare Access.

**Done when:** you can log in to the empty dashboard at your Railway URL.

---

## Handy commands

| Command                         | What it does                                  |
| ------------------------------- | --------------------------------------------- |
| `npm run dev`                   | Start the dev server                          |
| `npm run build` / `npm start`   | Production build / serve                      |
| `npm run lint`                  | ESLint                                        |
| `npx prisma migrate dev`        | Create/apply a migration locally              |
| `npx prisma migrate deploy`     | Apply migrations (production)                 |
| `npx prisma studio`             | Browse the database in the browser            |
| `npm run create-admin -- <email> <password> [name]` | Create/reset an admin |

---

## Phase 1 — how it works

### The intake API (called by the website)

`POST /api/orders/intake` replaces the order emails. The website posts the
cart/design request with a shared secret header `X-Api-Key: <INTAKE_API_KEY>`.
The app validates it (Zod), **re-prices catalogue lines from the database**
(never trusting the browser price), creates the order with a gapless
`orderNumber`, attaches uploaded design files, then fires the automation chain:
a **draft invoice** (with PDF) and a **new-order notification email** listing the
design files to use. See `../administration/docs/04` and `08` for the exact body
shape and the PHP change on the website side.

`POST /api/uploads/presign` returns a short-lived R2 upload URL (same API key).

Quick local test (with the dev server running):

```bash
curl -X POST http://localhost:3000/api/orders/intake \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $INTAKE_API_KEY" \
  -d '{"type":"WEBSHOP","customer":{"name":"Test","email":"t@example.be"},
       "items":[{"sku":"HEUP-LEER","name":"Heup flacon","unitPrice":"12.00",
       "quantity":1,"design":"Hert","uploadKeys":[]}]}'
```

### Dashboard

- **Bestellingen** — New / Open / Finished tabs, search, one-click status
  changes (each writes an audit event), and per-item design-file links.
- **Facturen** — draft review, **issue** (assigns the gapless `2026-0001`
  number), status updates, a Dexxter-reference field, and a PDF at
  `/invoices/:id/pdf`.

### Custom requests & offers (Aanvragen & offertes)

Custom work no longer lands in **Bestellingen** straight away. The flow is:

1. **Aanvraag** — an Atelier submission from the website (the intake API with
   `"type":"CUSTOM"` now creates a request instead of an order, same URL, no
   website change) or one you enter under *Aanvragen → Nieuwe aanvraag*. The
   request page shows the brief, files, and a timeline where you log questions
   to the customer and their answers (a question sets the status to *Wacht op
   klant*, an answer back to *In behandeling*).
2. **Offerte** — *+ Nieuwe offerte* on the request. Each line can carry a
   costing (materials + machine minutes + hours per piece, plus one-off
   design/set-up hours spread over the quantity) using the same rates and
   markup as the Kostprijs calculator; you choose the price (excl. or incl.
   VAT — stored incl. VAT like orders). Download the PDF at
   `/offers/:id/pdf`, send it, then *Markeer als verstuurd*. Need changes?
   *Nieuwe versie* copies it into a new draft.
3. **Klant aanvaardt** — creates a normal order (status *Bevestigd*) with the
   offer lines and a draft invoice, linked back to the request and offer. When
   it goes *In productie*, the materials costed on the offer are deducted from
   stock.

Code: `src/server/requests/`, `src/server/offers/`, `src/lib/request-actions.ts`,
`src/lib/offer-cost.ts` (costing math), `src/components/OfferEditor.tsx`.
Migration: `20260927120000_add_requests_and_offers` (additive only).

### Optional services (graceful without them locally)

- **Cloudflare R2** (`R2_*`): design-file storage. Without it, presign returns
  501 and invoice PDFs render on demand instead of being stored.
- **Resend** (`RESEND_API_KEY`): the new-order email. Without it, the email is
  logged (not sent) and still recorded in `NotificationLog`.
- **Company details** (`COMPANY_*`): printed on the invoice PDF. Fill with your
  real, accountant-approved values.

> **VAT model — verify with your accountant.** Catalogue/cart prices are treated
> as **VAT-inclusive** (B2C gross prices): the invoice derives the net base and
> VAT *out of* the gross so the total matches the cart. To price net instead,
> flip `PRICES_INCLUDE_VAT` in `src/server/invoices/invoiceMath.ts`.

### Handy Phase 1 commands

| Command | What it does |
| --- | --- |
| `npm run seed-demo` | Seed a small catalogue + one demo order (dev DB only) |
| `npm run import-products -- <products.csv>` | Import the catalogue from a CSV export of `products.xlsx` |
| `npm test` | Run the unit tests (invoice math, purchase-invoice checks, ...) |

## Inkoopfacturen (purchase invoices)

Supplier invoices you book as costs in Dexxter. Dexxter has no API, so this
module makes **capture immediate** and the **Dexxter upload a quick, tracked
routine**. It does not replace Dexxter's VAT return, tax filing or bank sync.

### How it works

```
upload / phone photo / forwarded e-mail
        │
        ▼
  Te controleren (RECEIVED) ──review & Bevestigen──▶ Klaar voor Dexxter (CHECKED)
                                                         │  Dexxter-pakket (.zip)
                                                         ▼  + "Markeer als In Dexxter"
                                                   In Dexxter (UPLOADED_TO_DEXXTER)
```

- **Capture** — *Inkoopfacturen → + Factuur toevoegen* (`/purchases/new`):
  drag & drop, file picker, or *Foto maken* (opens the phone camera). Each file
  becomes one invoice. Files are stored in R2 under `purchases/` the same way
  the other in-app uploads are (server action → `putObject`, 10 MB max).
- **Prefill (free, local)** — for a PDF with embedded text, [unpdf](https://github.com/unjs/unpdf)
  (Mozilla pdf.js, in-process) reads the text and simple patterns suggest the
  invoice number, date, amounts, currency, supplier VAT number/country, and spot
  "reverse charge" wording. A known supplier is recognised by VAT number or
  name. Photos/scans aren't OCR'd. Any failure → an empty form. No external or
  paid service, no API key.
- **Review** (`/purchases/:id`) — the file on the left, fields on the right.
  Suggestions are tagged *uit PDF*; picking a known supplier fills its
  remembered country, VAT number, currency, category and VAT treatment; gross
  follows net + VAT. **Ctrl/⌘+Enter** confirms and jumps to the next invoice,
  **Ctrl/⌘+S** saves. Nothing becomes *Klaar voor Dexxter* without you pressing
  *Bevestigen* (plain Enter only saves). Confirming updates the supplier's
  defaults (stored on `Supplier`, editable on the supplier page).
- **Checks** (warn, never block): net + VAT ≠ gross, VAT number vs country
  format, duplicate (same supplier + invoice number), invoice date > 180 days
  ago or > 7 days ahead, EU supplier outside Belgium that charged VAT, VAT
  treatment that doesn't fit the country, foreign currency without an EUR
  amount. Code: `src/lib/purchase-checks.ts`.
- **Dexxter queue** — the list opens on *Nog niet in Dexxter*; the dashboard
  shows the count. *Dexxter-pakket* (`/purchases/pack`) downloads every
  *Klaar voor Dexxter* file renamed `YYYY-MM-DD_supplier_invoicenumber.pdf` plus
  `samenvatting-<date>.csv` (semicolon, comma decimals — opens in Belgian
  Excel). After uploading them in Dexxter, tick and *Markeer als ‘In Dexxter’*.
  Only invoices that were in the pack and are still *Klaar voor Dexxter* move.
- **Quarter view** (`/purchases/quarter`) — per quarter (by invoice date):
  totals per VAT treatment in EUR, every invoice with a ✓/✗ Dexxter marker, and
  a reminder deadline. **It is a cross-check, not a VAT return** — no grid
  numbers or tax rules are coded. The deadline is the configurable constant
  `VAT_RETURN_DEADLINE` in `src/lib/purchase-quarter.ts` (currently day 25 of
  the month after the quarter) and is labelled *verify in Dexxter*.
- **Stock (optional)** — on a *Materialen* invoice you can book material into
  stock; the `StockMovement` is linked to the invoice (`purchaseInvoiceId`).
- **Audit** — every status change (and edit) is a `PurchaseInvoiceEvent`, shown
  as a timeline on the invoice.
- **Later** — a KBC CODA/CSV import can add its own `BankTransaction` table plus
  a link to `PurchaseInvoice` for payment matching; nothing here needs to change.

Code: `src/server/purchases/`, `src/lib/purchases.ts`, `src/lib/purchase-*.ts`,
`src/app/(dashboard)/purchases/`. Migration:
`20261024120000_add_purchase_invoices` (additive: new tables/enums, nullable
columns on `Supplier` and `StockMovement`, one new `NotificationType` value).

### Apply the migration — BEFORE deploying this code

The dashboard home counts purchase invoices, so deploy the code only after the
tables exist. From your laptop, over the **public** URL (see *Deploy to
Railway* step 4):

```bash
DATABASE_URL="postgresql://postgres:...@<host>.proxy.rlwy.net:PORT/railway" \
  npx prisma migrate deploy
```

### Environment variables

| Variable | Needed for |
| --- | --- |
| `R2_*` (existing) | storing invoice files; without R2 you can still *Zonder bestand invoeren* |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` (existing) | the 7-day nudge e-mail (logged instead when unset) |
| `CRON_SECRET` (existing, falls back to `INTAKE_API_KEY`) | `/api/cron/purchase-reminders` |
| `PURCHASE_INBOUND_SECRET` (new, optional) | inbound e-mail webhook; unset = endpoint off |
| `COMPANY_VAT` (existing) | so the prefill skips *your own* VAT number printed on supplier invoices |

### Nudge e-mail (7 days) — wiring a scheduler on Railway

`GET/POST /api/cron/purchase-reminders` with header `X-Api-Key: <CRON_SECRET>`
e-mails you when invoices sit in *Te controleren* or *Klaar voor Dexxter* for
more than 7 days. It throttles itself (each invoice at most once every 3 days),
so a daily call is right. Railway runs cron as a service that starts on a
schedule and exits:

1. In the same Railway project: **New → Docker Image** → `curlimages/curl:8.10.1`.
2. Variables: `CRON_SECRET` = the app's secret (or `${{<app-service>.CRON_SECRET}}`).
3. Settings → **Custom Start Command**:
   ```
   sh -c 'curl -fsS -H "X-Api-Key: $CRON_SECRET" https://admin.creafluxe.be/api/cron/purchase-reminders && curl -fsS -H "X-Api-Key: $CRON_SECRET" https://admin.creafluxe.be/api/cron/low-stock'
   ```
   (this also covers the existing low-stock check).
4. Settings → **Cron Schedule**: `0 7 * * *` (07:00 UTC daily), or
   `0 7 * * 0,4` (Thursday and Sunday 07:00 UTC). Note the low-stock check in
   the same command then runs on those days only.

Any external scheduler that can send a header (e.g. cron-job.org) works too.

### Inbound e-mail (optional, separate step)

Upload works on its own; e-mail is a convenience on top. The app side is done:
`POST /api/webhooks/purchase-invoices`, protected by `PURCHASE_INBOUND_SECRET`,
takes JSON `{ messageId, from, subject, attachments: [{ filename, contentType,
content (base64) }] }` and creates one *Te controleren* invoice per PDF/image
attachment (tiny inline images and duplicates of the same message are skipped).

What's left is getting mail for a dedicated address into that webhook. The
simplest free route, since the domain is on Cloudflare: **Cloudflare Email
Routing → an Email Worker** that parses the mail and posts it. A template is
in `scripts/inbound-email-worker.example.js` (with setup steps; it only
accepts mail you forward yourself). Use a subdomain (e.g. `in.creafluxe.be`)
so your normal mailbox's MX records stay untouched. Any inbound-mail provider
that can POST JSON works as well, with a small adapter.

### Test it locally

You need a database with the new tables — **not** the Railway one. For example
a throwaway Postgres in Docker:

```bash
docker run --name cf-dev -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
```

Then point `.env`'s `DATABASE_URL` at
`postgresql://postgres:dev@localhost:5432/postgres`, and:

```bash
npx prisma migrate deploy
npx tsx scripts/create-admin.ts you@example.be "a-test-password"
npm run dev
```

- Without R2: *Zonder bestand invoeren* → fill the form → *Bevestigen* → check
  the list, pack (CSV only), quarter view and dashboard card.
- With R2 (`R2_*` set): upload a supplier PDF and watch the prefill.
- Nudge: `curl -H "X-Api-Key: $CRON_SECRET" http://localhost:3000/api/cron/purchase-reminders`
  (logs the e-mail when Resend isn't configured; an invoice must be > 7 days in
  its status — adjust `statusChangedAt` in `npx prisma studio` to try it).
- Inbound e-mail (needs R2 and `PURCHASE_INBOUND_SECRET`):
  ```bash
  curl -X POST http://localhost:3000/api/webhooks/purchase-invoices \
    -H "Content-Type: application/json" -H "X-Api-Key: $PURCHASE_INBOUND_SECRET" \
    -d "{\"messageId\":\"<t1@test>\",\"subject\":\"Rechnung\",\"attachments\":[{\"filename\":\"r.pdf\",\"contentType\":\"application/pdf\",\"content\":\"$(base64 -w0 some-invoice.pdf)\"}]}"
  ```
- Unit tests: `npm test` (checks, quarter boundaries, file names/CSV/zip,
  text prefill, status rules, reminder throttling).

## What comes next (Phase 2)

Catalogue-management UI, customer history/search, a branded invoice layout, then
inventory (Phase 2b) and payments/e-invoicing (Phase 3/4). The `server/`, `lib/`
and schema are already laid out for those.
