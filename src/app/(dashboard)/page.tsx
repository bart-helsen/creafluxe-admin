import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEUR, formatDateTime } from "@/lib/money";
import { STATUS_BUCKETS, STATUS_LABELS } from "@/server/orders/changeStatus";

// Live dashboard: the order buckets, draft-invoice count, low-stock warning and
// this-month figures, plus the most recent orders — the at-a-glance view of the
// workshop's day.

export default async function DashboardHome() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [newCount, openCount, draftCount, materials, monthOrders, monthPaid, recent] =
    await Promise.all([
      prisma.order.count({ where: { status: { in: STATUS_BUCKETS.NEW } } }),
      prisma.order.count({ where: { status: { in: STATUS_BUCKETS.OPEN } } }),
      prisma.invoice.count({ where: { status: "DRAFT" } }),
      prisma.material.findMany({
        where: { active: true },
        select: { stockQuantity: true, reorderLevel: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { status: "PAID", updatedAt: { gte: monthStart } },
      }),
      prisma.order.findMany({
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

  const lowCount = materials.filter((m) =>
    new Prisma.Decimal(m.stockQuantity).lte(m.reorderLevel),
  ).length;
  const monthRevenue = monthPaid._sum.total?.toString() ?? "0";

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
        <Link
          href="/materials?filter=low"
          className="stat-card stat-card--link"
        >
          <span className="stat-label">Materialen laag</span>
          <span className={`stat-value ${lowCount > 0 ? "stock-low" : ""}`}>
            {lowCount}
          </span>
          <span className="stat-hint">Op of onder bestelpunt</span>
        </Link>
      </section>

      <section className="card-grid">
        <div className="stat-card">
          <span className="stat-label">Bestellingen deze maand</span>
          <span className="stat-value">{monthOrders}</span>
          <span className="stat-hint">Sinds de 1e</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Omzet deze maand</span>
          <span className="stat-value">{formatEUR(monthRevenue)}</span>
          <span className="stat-hint">Betaalde facturen</span>
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
