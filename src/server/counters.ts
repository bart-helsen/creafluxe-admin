import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Atomic, gapless sequential numbers for orders and invoices.
//
// Belgian invoices must be numbered sequentially with NO gaps (docs/03). You
// cannot derive that from COUNT(*) (drafts/deletes would break it) or from
// timestamps. Instead we keep one Counter row per (name, year) and increment it
// atomically with a single Postgres statement:
//
//   INSERT ... ON CONFLICT (name, year) DO UPDATE SET value = value + 1 RETURNING value
//
// A single UPSERT is atomic under concurrency, so every caller gets a distinct,
// consecutive number exactly once — even if two orders arrive simultaneously.

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Increment and return the next value for a counter.
 * Orders use year = 0 (a sentinel meaning "not year-scoped") so orderNumber
 * stays globally unique; invoices pass the calendar year for yearly reset.
 * Pass a transaction client when the number must be assigned inside a larger
 * transaction (e.g. issuing an invoice).
 */
export async function nextCounter(
  name: "order" | "invoice",
  year: number,
  db: Db = prisma,
): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>(Prisma.sql`
    INSERT INTO "Counter" ("id", "name", "year", "value")
    VALUES (${randomUUID()}, ${name}, ${year}, 1)
    ON CONFLICT ("name", "year")
    DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value";
  `);
  return rows[0].value;
}

/** The next order number (globally sequential). */
export function nextOrderNumber(db: Db = prisma): Promise<number> {
  return nextCounter("order", 0, db);
}

/**
 * The next invoice number, formatted "YYYY-0001" (docs/03). Must be called
 * inside the issue transaction so a crash never burns a number silently.
 */
export async function nextInvoiceNumber(
  year: number,
  db: Db = prisma,
): Promise<string> {
  const seq = await nextCounter("invoice", year, db);
  return `${year}-${String(seq).padStart(4, "0")}`;
}
