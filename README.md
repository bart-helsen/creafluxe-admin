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
| `npm test` | Run the invoice-math unit tests |

## What comes next (Phase 2)

Catalogue-management UI, customer history/search, a branded invoice layout, then
inventory (Phase 2b) and payments/e-invoicing (Phase 3/4). The `server/`, `lib/`
and schema are already laid out for those.
