import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/money";

// Customer list + search (Phase 2, docs/07). Customers are created automatically
// at order intake; here you can browse, search and open a customer's history.

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? "").trim();

  const customers = await prisma.customer.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { companyName: { contains: search, mode: "insensitive" } },
            { vatNumber: { contains: search, mode: "insensitive" } },
          ],
        }
      : {},
    include: { _count: { select: { orders: true, invoices: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="page">
      <header className="page-header">
        <h1>Klanten</h1>
        <p className="muted">
          Klanten worden automatisch aangemaakt bij een bestelling. Zoek en open
          hun geschiedenis.
        </p>
      </header>

      <div className="tabs">
        <form className="tab-search" action="/customers">
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam, e-mail, bedrijf of btw-nr"
            defaultValue={search}
          />
        </form>
      </div>

      {customers.length === 0 ? (
        <div className="panel">
          <p className="muted">Geen klanten gevonden.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>E-mail</th>
                <th>Type</th>
                <th>Bestellingen</th>
                <th>Facturen</th>
                <th>Sinds</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/customers/${c.id}`} className="link-strong">
                      {c.name}
                    </Link>
                    {c.companyName && (
                      <div className="muted small">{c.companyName}</div>
                    )}
                  </td>
                  <td className="muted small">{c.email}</td>
                  <td>
                    <span className="status-pill">
                      {c.isBusiness ? "Onderneming" : "Particulier"}
                    </span>
                  </td>
                  <td>{c._count.orders}</td>
                  <td>{c._count.invoices}</td>
                  <td className="muted small">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
