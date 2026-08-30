import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatEUR, formatDateTime } from "@/lib/money";
import { STATUS_BUCKETS, STATUS_LABELS } from "@/server/orders/changeStatus";

// Orders list with the three buckets you think in: New / Open / Finished
// (Flow 4, docs/05). Tab + free-text search via the query string.

type Bucket = "NEW" | "OPEN" | "FINISHED";
const BUCKET_LABELS: Record<Bucket, string> = {
  NEW: "Nieuw",
  OPEN: "Open",
  FINISHED: "Afgewerkt",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; q?: string }>;
}) {
  const { bucket: bucketParam, q } = await searchParams;
  const bucket: Bucket = (["NEW", "OPEN", "FINISHED"] as Bucket[]).includes(
    bucketParam as Bucket,
  )
    ? (bucketParam as Bucket)
    : "NEW";
  const search = (q ?? "").trim();

  const [newCount, openCount, finishedCount] = await Promise.all([
    prisma.order.count({ where: { status: { in: STATUS_BUCKETS.NEW } } }),
    prisma.order.count({ where: { status: { in: STATUS_BUCKETS.OPEN } } }),
    prisma.order.count({ where: { status: { in: STATUS_BUCKETS.FINISHED } } }),
  ]);
  const counts: Record<Bucket, number> = {
    NEW: newCount,
    OPEN: openCount,
    FINISHED: finishedCount,
  };

  const searchNumber = Number(search);
  const orders = await prisma.order.findMany({
    where: {
      status: { in: STATUS_BUCKETS[bucket] },
      ...(search
        ? {
            OR: [
              { customer: { name: { contains: search, mode: "insensitive" } } },
              { customer: { email: { contains: search, mode: "insensitive" } } },
              ...(Number.isInteger(searchNumber)
                ? [{ orderNumber: searchNumber }]
                : []),
            ],
          }
        : {}),
    },
    include: { customer: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="page">
      <header className="page-header">
        <h1>Bestellingen</h1>
        <p className="muted">
          Alle bestellingen komen hier binnen — geen e-mails meer om uit te
          pluizen.
        </p>
      </header>

      <div className="tabs">
        {(["NEW", "OPEN", "FINISHED"] as Bucket[]).map((b) => (
          <Link
            key={b}
            href={`/orders?bucket=${b}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={`tab ${b === bucket ? "tab--active" : ""}`}
          >
            {BUCKET_LABELS[b]}
            <span className="tab-count">{counts[b]}</span>
          </Link>
        ))}
        <form className="tab-search" action="/orders">
          <input type="hidden" name="bucket" value={bucket} />
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam, e-mail of #"
            defaultValue={search}
          />
        </form>
      </div>

      {orders.length === 0 ? (
        <div className="panel">
          <p className="muted">Geen bestellingen in deze categorie.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Klant</th>
                <th>Artikelen</th>
                <th>Totaal</th>
                <th>Status</th>
                <th>Ontvangen</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.id}`} className="link-strong">
                      #{o.orderNumber}
                    </Link>
                  </td>
                  <td>
                    <div>{o.customer.name}</div>
                    <div className="muted small">{o.customer.email}</div>
                  </td>
                  <td>{o._count.items}</td>
                  <td>{formatEUR(o.total.toString())}</td>
                  <td>
                    <span className="status-pill">{STATUS_LABELS[o.status]}</span>
                  </td>
                  <td className="muted small">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
