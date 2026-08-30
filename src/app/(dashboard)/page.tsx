import { auth } from "@/lib/auth";

export default async function DashboardHome() {
  const session = await auth();

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">
          Signed in as {session?.user?.email}. The skeleton is live — order
          intake, tracking and invoicing arrive in Phase 1.
        </p>
      </header>

      <section className="card-grid">
        <div className="stat-card">
          <span className="stat-label">New orders</span>
          <span className="stat-value">—</span>
          <span className="stat-hint">Wired up in Phase 1</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Open orders</span>
          <span className="stat-value">—</span>
          <span className="stat-hint">Wired up in Phase 1</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Draft invoices</span>
          <span className="stat-value">—</span>
          <span className="stat-hint">Wired up in Phase 1</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Low-stock materials</span>
          <span className="stat-value">—</span>
          <span className="stat-hint">Wired up in Phase 2b</span>
        </div>
      </section>

      <section className="panel">
        <h2>Phase 0 complete</h2>
        <p>
          You are looking at the protected admin dashboard. The Next.js app,
          Prisma schema, database migration and login are all in place. From
          here, Phase 1 adds the <code>/api/orders/intake</code> endpoint, the
          orders screens and the automatic draft-invoice flow.
        </p>
      </section>
    </div>
  );
}
