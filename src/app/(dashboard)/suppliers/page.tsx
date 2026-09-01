import Link from "next/link";
import { prisma } from "@/lib/db";

// Suppliers list (Phase 2b, docs/11). Who you buy materials from.

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const { q, show } = await searchParams;
  const search = (q ?? "").trim();
  const includeInactive = show === "all";

  const suppliers = await prisma.supplier.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { _count: { select: { supplierMaterials: true } } },
    orderBy: { name: "asc" },
    take: 200,
  });

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <h1>Leveranciers</h1>
          <p className="muted">
            Beheer je leveranciers en zie per leverancier wat je er koopt.
          </p>
        </div>
        <Link href="/suppliers/new" className="btn-primary">
          + Nieuwe leverancier
        </Link>
      </header>

      <div className="tabs">
        <Link
          href="/suppliers"
          className={`tab ${!includeInactive ? "tab--active" : ""}`}
        >
          Actief
        </Link>
        <Link
          href="/suppliers?show=all"
          className={`tab ${includeInactive ? "tab--active" : ""}`}
        >
          Alle
        </Link>
        <form className="tab-search" action="/suppliers">
          {includeInactive && <input type="hidden" name="show" value="all" />}
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam of e-mail"
            defaultValue={search}
          />
        </form>
      </div>

      {suppliers.length === 0 ? (
        <div className="panel">
          <p className="muted">Geen leveranciers gevonden.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>E-mail</th>
                <th>Telefoon</th>
                <th>Materialen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/suppliers/${s.id}`} className="link-strong">
                      {s.name}
                    </Link>
                  </td>
                  <td className="muted small">{s.email ?? "—"}</td>
                  <td className="muted small">{s.phone ?? "—"}</td>
                  <td>{s._count.supplierMaterials}</td>
                  <td>
                    <span className="status-pill">
                      {s.active ? "Actief" : "Inactief"}
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
