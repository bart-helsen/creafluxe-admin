import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";

// Catalogue list (Phase 2, docs/07). Add/edit products so you stop touching the
// spreadsheet. Free-text search by name/SKU/filter; toggle inactive products.

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const { q, show } = await searchParams;
  const search = (q ?? "").trim();
  const includeInactive = show === "all";

  const products = await prisma.product.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
              { filter: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { options: true, bomLines: true, designs: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 200,
  });

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <h1>Catalogus</h1>
          <p className="muted">
            Beheer je producten, opties, prijzen en masterbestanden — de
            catalogus draait vanuit de app, niet meer uit de spreadsheet.
          </p>
        </div>
        <Link href="/products/new" className="btn-primary">
          + Nieuw product
        </Link>
      </header>

      <div className="tabs">
        <Link
          href="/products"
          className={`tab ${!includeInactive ? "tab--active" : ""}`}
        >
          Actief
        </Link>
        <Link
          href="/products?show=all"
          className={`tab ${includeInactive ? "tab--active" : ""}`}
        >
          Alle
        </Link>
        <form className="tab-search" action="/products">
          {includeInactive && <input type="hidden" name="show" value="all" />}
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam, SKU of filter"
            defaultValue={search}
          />
        </form>
      </div>

      {products.length === 0 ? (
        <div className="panel">
          <p className="muted">
            Geen producten gevonden. Maak er een aan of importeer met{" "}
            <code>npm run import-products</code>.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Naam</th>
                <th>Basisprijs</th>
                <th>Btw</th>
                <th>Opties</th>
                <th>Stuklijst</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/products/${p.id}`} className="link-strong">
                      {p.sku}
                    </Link>
                  </td>
                  <td>
                    {p.name}
                    {p.filter && (
                      <div className="muted small">{p.filter}</div>
                    )}
                  </td>
                  <td>{formatEUR(p.basePrice.toString())}</td>
                  <td>{Number(p.vatRate)}%</td>
                  <td>{p._count.options}</td>
                  <td>{p._count.bomLines}</td>
                  <td>
                    <span className="status-pill">
                      {p.active ? "Actief" : "Inactief"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
