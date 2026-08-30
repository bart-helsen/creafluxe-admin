# Creafluxe Admin

Internal administration software for Creafluxe — order intake, tracking, and
invoicing. Built with **Next.js (App Router) + TypeScript + Prisma + PostgreSQL**,
following the blueprint in `../administration/`.

This repository is **Phase 0**: the running skeleton. When you finish the steps
below you can log in to an empty, protected dashboard backed by the full
database schema. Phase 1 (order intake, orders screens, draft invoices) builds
on top of it.

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

   | Variable          | Value                                                        |
   | ----------------- | ------------------------------------------------------------ |
   | `DATABASE_URL`    | the Postgres **private** URL (`${{Postgres.DATABASE_URL}}`)  |
   | `AUTH_SECRET`     | the same secret you generated (or a fresh one)               |
   | `AUTH_TRUST_HOST` | `true`                                                       |

3. **Build & start commands** (Railway → *Settings*):
   - Build: `npm run build`
   - Start: `npx prisma migrate deploy && npm run start`

   `migrate deploy` applies your committed migrations to the Railway database on
   every deploy (safe and idempotent).

4. **First admin on Railway:** once deployed, run the create-admin script
   against the Railway database — either from your laptop with `DATABASE_URL`
   temporarily pointed at the **public** Railway URL, or via `railway run`:

   ```bash
   railway run npx tsx scripts/create-admin.ts bart@creafluxe.be "a-strong-password" "Bart Helsen"
   ```

5. **Custom domain (optional now):** add `admin.creafluxe.be` in Railway and a
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

## What comes next (Phase 1)

From the roadmap (`../administration/docs/07-roadmap.md`): the
`POST /api/orders/intake` endpoint, R2 uploads, the New/Open/Finished orders
screens, the new-order notification email, and the automatic draft invoice.
The folders and libraries are already laid out so those slot straight in.
