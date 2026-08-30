import { Prisma } from "@prisma/client";

// Money and date helpers. All amounts are EUR and represented as Prisma.Decimal
// (decimal.js under the hood) — never JS floats, which introduce rounding errors
// that are unacceptable on invoices. See docs/03 ("Money is Decimal(10,2)").

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Coerce a number/string/Decimal into a Prisma.Decimal. */
export function toDecimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Round to 2 decimals (money) using half-up, returning a Decimal. */
export function money(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

const eurFormatter = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

/** Format a money value the Belgian way, e.g. "€ 12,00". */
export function formatEUR(value: Prisma.Decimal | string | number): string {
  const n = typeof value === "number" ? value : Number(value.toString());
  return eurFormatter.format(n);
}

const dateFormatter = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Render a UTC timestamp as a Brussels-local date, e.g. "30/08/2026". */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return dateFormatter.format(new Date(date));
}

/** Render a UTC timestamp as a Brussels-local date + time. */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return dateTimeFormatter.format(new Date(date));
}
