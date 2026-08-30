import Link from "next/link";
import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEUR, formatDate } from "@/lib/money";

// Invoice list with a status filter (docs/04 §B). Drafts are auto-created from
// orders; you review them here and finalise in Dexxter.

const STATUSES: (InvoiceStatus | "ALL")[] = [
  "ALL",
  "DRAFT",
  "ISSUED",
  "SENT",
  "PAID",
  "OVERDUE",
  "CANCELLED",
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = (STATUSES.includes(status as InvoiceStatus) ? status : "ALL") as
    | InvoiceStatus
    | "ALL";

  const invoices = await prisma.invoice.findMany({
    where: active === "ALL" ? {} : { status: active },
    include: { customer: true, order: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="page">
      <header className="page-header">
        <h1>Facturen</h1>
        <p className="muted">
          Concepten worden automatisch aangemaakt bij elke bestelling. Controleer
          ze hier en verwerk ze in Dexxter.
        </p>
      </header>

      <div className="tabs">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "ALL" ? "/invoices" : `/invoices?status=${s}`}
            className={`tab ${s === active ? "tab--active" : ""}`}
          >
            {s === "ALL" ? "Alle" : s}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <div className="panel">
          <p className="muted">Geen facturen in deze categorie.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Bestelling</th>
                <th>Klant</th>
                <th>Totaal</th>
                <th>Status</th>
                <th>Datum</th>
                <th>Dexxter</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/invoices/${inv.id}`} className="link-strong">
                      {inv.invoiceNumber ?? "concept"}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/orders/${inv.orderId}`}>
                      #{inv.order.orderNumber}
                    </Link>
                  </td>
                  <td>
                    <div>{inv.customer.name}</div>
                    <div className="muted small">{inv.customer.email}</div>
                  </td>
                  <td>{formatEUR(inv.total.toString())}</td>
                  <td>
                    <span className="status-pill">{inv.status}</span>
                  </td>
                  <td className="muted small">
                    {formatDate(inv.issueDate ?? inv.createdAt)}
                  </td>
                  <td className="muted small">{inv.dexxterRef ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
