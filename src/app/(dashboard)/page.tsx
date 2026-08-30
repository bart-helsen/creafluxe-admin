import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatEUR, formatDateTime } from "@/lib/money";
import { STATUS_BUCKETS, STATUS_LABELS } from "@/server/orders/changeStatus";

// Live dashboard: the three order buckets, draft-invoice count, and the most
// recent orders — the at-a-glance view of the workshop's day.

export default async function DashboardHome() {
  const [newCount, openCount, draftCount, recent] = await Promise.all([
    prisma.order.count({ where: { status: { in: STATUS_BUCKETS.NEW } } }),
    prisma.order.count({ where: { status: { in: STATUS_BUCKETS.OPEN } } }),
    prisma.invoice.count({ where: { status: "DRAFT" } }),
    prisma.order.findMany({
      include: { customer: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">Overzicht van bestellingen en facturen.</p>
      </header>

      <section className="card-grid">
        <Link href="/orders?bucket=NEW" className="stat-card stat-card--link">
          <span className="stat-label">Nieuwe bestellingen</span>
          <span className="stat-value">{newCount}</span>
          <span className="stat-hint">Wachten op verwerking</span>
        </Link>
        <Link href="/orders?bucket=OPEN" className="stat-card stat-card--link">
          <span className="stat-label">Open bestellingen</span>
          <span className="stat-value">{openCount}</span>
          <span className="stat-hint">In behandeling / productie</span>
        </Link>
        <Link href="/invoices?status=DRAFT" className="stat-card stat-card--link">
          <span className="stat-label">Concept-facturen</span>
          <span className="stat-value">{draftCount}</span>
          <span className="stat-hint">Te controleren</span>
        </Link>
        <div className="stat-card">
          <span className="stat-label">Materialen laag</span>
          <span className="stat-value">—</span>
          <span className="stat-hint">Fase 2b</span>
        </div>
      </section>

      <section className="panel">
        <h2>Recente bestellingen</h2>
        {recent.length === 0 ? (
          <p className="muted">
            Nog geen bestellingen. Zodra de website naar{" "}
            <code>/api/orders/intake</code> post, verschijnen ze hier.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Klant</th>
                  <th>Totaal</th>
                  <th>Status</th>
                  <th>Ontvangen</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="link-strong">
                        #{o.orderNumber}
                      </Link>
                    </td>
                    <td>{o.customer.name}</td>
                    <td>{formatEUR(o.total.toString())}</td>
                    <td>
                      <span className="status-pill">
                        {STATUS_LABELS[o.status]}
                      </span>
                    </td>
                    <td className="muted small">
                      {formatDateTime(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
