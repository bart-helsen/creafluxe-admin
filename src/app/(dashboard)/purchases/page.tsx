import Link from "next/link";
import type { PurchaseInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatEUR } from "@/lib/money";
import { checkPurchaseInvoice, findDuplicates, todayInBrussels } from "@/lib/purchase-checks";
import {
  PURCHASE_BUCKETS,
  PURCHASE_BUCKET_LABELS,
  PURCHASE_STATUS_LABELS,
  VAT_TREATMENT_LABELS,
  countryLabel,
  purchaseTitle,
  type PurchaseBucket,
} from "@/lib/purchases";
import { isoDate } from "@/server/purchases/purchaseInvoices";

// Inkoopfacturen: every supplier invoice from capture to Dexxter. The default
// tab is "Nog niet in Dexxter" — what still needs your attention.

const BUCKETS = Object.keys(PURCHASE_BUCKETS) as PurchaseBucket[];

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; q?: string; confirmed?: string }>;
}) {
  const { bucket: bucketParam, q, confirmed } = await searchParams;
  const bucket: PurchaseBucket = BUCKETS.includes(bucketParam as PurchaseBucket)
    ? (bucketParam as PurchaseBucket)
    : "OPEN";
  const search = (q ?? "").trim();
  const statuses = (b: PurchaseBucket) => PURCHASE_BUCKETS[b] as PurchaseInvoiceStatus[];

  const [counts, invoices, numbered] = await Promise.all([
    Promise.all(
      BUCKETS.map(async (b) => [
        b,
        await prisma.purchaseInvoice.count({ where: { status: { in: statuses(b) } } }),
      ]),
    ).then((e) => Object.fromEntries(e) as Record<PurchaseBucket, number>),
    prisma.purchaseInvoice.findMany({
      where: {
        status: { in: statuses(bucket) },
        ...(search
          ? {
              OR: [
                { supplierName: { contains: search, mode: "insensitive" } },
                { invoiceNumber: { contains: search, mode: "insensitive" } },
                { fileName: { contains: search, mode: "insensitive" } },
                { notes: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      // Oldest first while it still needs work; newest first for the archive.
      orderBy:
        bucket === "UPLOADED" || bucket === "ALL"
          ? [{ invoiceDate: { sort: "desc", nulls: "first" } }, { receivedAt: "desc" }]
          : { receivedAt: "asc" },
      take: 200,
    }),
    prisma.purchaseInvoice.findMany({
      where: { invoiceNumber: { not: null } },
      select: { id: true, supplierId: true, supplierName: true, invoiceNumber: true },
    }),
  ]);

  const today = todayInBrussels();
  const readyCount = counts.CHECKED;

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <h1>Inkoopfacturen</h1>
          <p className="muted">
            Leveranciersfacturen van ontvangst tot Dexxter: upload of mail ze door, controleer de
            gegevens, en upload ze in één pakket naar Dexxter.
          </p>
        </div>
        <div className="header-actions header-actions--row">
          <Link href="/purchases/quarter" className="btn-ghost btn-ghost--dark">
            Kwartaaloverzicht
          </Link>
          <Link href="/purchases/pack" className="btn-ghost btn-ghost--dark">
            Dexxter-pakket{readyCount > 0 ? ` (${readyCount})` : ""}
          </Link>
          <Link href="/purchases/new" className="btn-primary">
            + Factuur toevoegen
          </Link>
        </div>
      </header>

      {confirmed && (
        <p className="form-success" role="status">
          Bevestigd ✓ — niets meer te controleren.{" "}
          {readyCount > 0 && (
            <Link href="/purchases/pack" className="link-strong">
              Naar het Dexxter-pakket →
            </Link>
          )}
        </p>
      )}

      <div className="tabs">
        {BUCKETS.map((b) => (
          <Link
            key={b}
            href={`/purchases?bucket=${b}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={`tab ${b === bucket ? "tab--active" : ""}`}
          >
            {PURCHASE_BUCKET_LABELS[b]}
            <span className="tab-count">{counts[b]}</span>
          </Link>
        ))}
        <form className="tab-search" action="/purchases">
          <input type="hidden" name="bucket" value={bucket} />
          <input
            type="search"
            name="q"
            placeholder="Zoek op leverancier, nummer of bestand"
            defaultValue={search}
          />
        </form>
      </div>

      {invoices.length === 0 ? (
        <div className="panel">
          <p className="muted">
            {bucket === "OPEN"
              ? "Alles staat in Dexxter. 🎉 Nieuwe factuur? Upload ze meteen via ‘+ Factuur toevoegen’."
              : "Geen inkoopfacturen in deze categorie."}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Factuur</th>
                <th>Datum</th>
                <th>Bruto</th>
                <th>Btw</th>
                <th>Status</th>
                <th>Ontvangen</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((p) => {
                const flags = checkPurchaseInvoice(
                  {
                    ...p,
                    invoiceDate: isoDate(p.invoiceDate),
                    netAmount: p.netAmount?.toString(),
                    vatAmount: p.vatAmount?.toString(),
                    grossAmount: p.grossAmount?.toString(),
                    amountEur: p.amountEur?.toString(),
                  },
                  { today, duplicates: findDuplicates(p, numbered) },
                );
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/purchases/${p.id}`} className="link-strong">
                        {purchaseTitle(p)}
                      </Link>
                      <div className="muted small">
                        {p.supplierCountry ? countryLabel(p.supplierCountry) : ""}
                        {p.source === "EMAIL" ? " · via e-mail" : ""}
                        {flags.length > 0 && (
                          <span className="flag-badge" title={flags.map((f) => f.message).join("\n")}>
                            ⚠ {flags.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="nowrap">{formatDate(p.invoiceDate)}</td>
                    <td className="nowrap">
                      {p.grossAmount == null
                        ? "—"
                        : p.currency === "EUR"
                          ? formatEUR(p.grossAmount.toString())
                          : `${p.currency} ${p.grossAmount.toString().replace(".", ",")}`}
                    </td>
                    <td className="small">
                      {p.status === "RECEIVED" ? (
                        <span className="muted">—</span>
                      ) : (
                        VAT_TREATMENT_LABELS[p.vatTreatment]
                      )}
                    </td>
                    <td>
                      <span className={`status-pill status-pill--purchase-${p.status.toLowerCase()}`}>
                        {PURCHASE_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="muted small">{formatDateTime(p.receivedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
