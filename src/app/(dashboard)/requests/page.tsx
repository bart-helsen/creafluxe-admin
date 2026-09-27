import Link from "next/link";
import type { RequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEUR, formatDateTime } from "@/lib/money";
import { channelLabel } from "@/lib/manual-order";
import {
  REQUEST_BUCKETS,
  REQUEST_BUCKET_LABELS,
  REQUEST_STATUS_LABELS,
  formatRequestNumber,
  requestTitle,
  type RequestBucket,
} from "@/lib/requests";

// Aanvragen: custom requests from the website's Atelier form and the ones you
// entered by hand. Not orders yet — each one waits for your offer.

const BUCKETS = Object.keys(REQUEST_BUCKETS) as RequestBucket[];

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; q?: string }>;
}) {
  const { bucket: bucketParam, q } = await searchParams;
  const bucket: RequestBucket = BUCKETS.includes(bucketParam as RequestBucket)
    ? (bucketParam as RequestBucket)
    : "OPEN";
  const search = (q ?? "").trim();
  const statuses = (b: RequestBucket) => REQUEST_BUCKETS[b] as RequestStatus[];

  const counts = Object.fromEntries(
    await Promise.all(
      BUCKETS.map(async (b) => [
        b,
        await prisma.quoteRequest.count({ where: { status: { in: statuses(b) } } }),
      ]),
    ),
  ) as Record<RequestBucket, number>;

  const searchNumber = Number(search.replace(/^a-?/i, ""));
  const requests = await prisma.quoteRequest.findMany({
    where: {
      status: { in: statuses(bucket) },
      ...(search
        ? {
            OR: [
              { customer: { name: { contains: search, mode: "insensitive" } } },
              { customer: { email: { contains: search, mode: "insensitive" } } },
              { customer: { phone: { contains: search } } },
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              ...(search && Number.isInteger(searchNumber) && searchNumber > 0
                ? [{ requestNumber: searchNumber }]
                : []),
            ],
          }
        : {}),
    },
    include: {
      customer: true,
      order: { select: { id: true, orderNumber: true } },
      offers: {
        orderBy: { version: "desc" },
        take: 1,
        select: { offerNumber: true, status: true, total: true },
      },
    },
    // Oldest first while open (first come, first served); newest first otherwise.
    orderBy: { createdAt: bucket === "OPEN" ? "asc" : "desc" },
    take: 100,
  });

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <h1>Aanvragen</h1>
          <p className="muted">
            Maatwerkaanvragen via het Atelier of rechtstreeks. Maak een offerte; na akkoord van
            de klant wordt het een bestelling.
          </p>
        </div>
        <Link href="/requests/new" className="btn-primary">
          + Nieuwe aanvraag
        </Link>
      </header>

      <div className="tabs">
        {BUCKETS.map((b) => (
          <Link
            key={b}
            href={`/requests?bucket=${b}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={`tab ${b === bucket ? "tab--active" : ""}`}
          >
            {REQUEST_BUCKET_LABELS[b]}
            <span className="tab-count">{counts[b]}</span>
          </Link>
        ))}
        <form className="tab-search" action="/requests">
          <input type="hidden" name="bucket" value={bucket} />
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam, e-mail, omschrijving of A-nr"
            defaultValue={search}
          />
        </form>
      </div>

      {requests.length === 0 ? (
        <div className="panel">
          <p className="muted">Geen aanvragen in deze categorie.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Aanvraag</th>
                <th>Klant</th>
                <th>Status</th>
                <th>Laatste offerte</th>
                <th>Ontvangen</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const offer = r.offers[0];
                return (
                  <tr key={r.id}>
                    <td className="nowrap">
                      <Link href={`/requests/${r.id}`} className="link-strong">
                        {formatRequestNumber(r.requestNumber)}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/requests/${r.id}`}>{requestTitle(r)}</Link>
                      {r.channel !== "website" && (
                        <div className="muted small">via {channelLabel(r.channel).toLowerCase()}</div>
                      )}
                    </td>
                    <td>
                      <div>{r.customer.name}</div>
                      <div className="muted small">{r.customer.email || r.customer.phone}</div>
                    </td>
                    <td>
                      <span className={`status-pill status-pill--${r.status.toLowerCase()}`}>
                        {REQUEST_STATUS_LABELS[r.status]}
                      </span>
                      {r.order && (
                        <div className="small">
                          <Link href={`/orders/${r.order.id}`} className="link-strong">
                            Bestelling #{r.order.orderNumber}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {offer ? (
                        <>
                          {formatEUR(offer.total.toString())}
                          <div className="muted small">{offer.offerNumber}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted small">{formatDateTime(r.createdAt)}</td>
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
