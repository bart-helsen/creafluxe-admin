import Link from "next/link";
import { Prisma, type MaterialCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";

// Materials list with a Low-stock filter and search (Phase 2b, docs/11). Stock
// levels are live — the running total of every stock movement.

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  WOOD: "Hout",
  PLASTIC: "Plastic",
  METAL: "Metaal",
  PAPER: "Papier",
  GADGET: "Gadget",
  CONSUMABLE: "Verbruik",
  OTHER: "Overig",
};

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; show?: string }>;
}) {
  const { q, filter, show } = await searchParams;
  const search = (q ?? "").trim();
  const lowOnly = filter === "low";
  const includeInactive = show === "all";

  const materials = await prisma.material.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { currentSupplier: true },
    orderBy: { name: "asc" },
    take: 400,
  });

  // Low-stock is a computed comparison (stockQuantity <= reorderLevel), which
  // Prisma can't express as a column-to-column filter, so we filter in memory.
  const lowMaterials = materials.filter(
    (m) => new Prisma.Decimal(m.stockQuantity).lte(m.reorderLevel),
  );
  const shown = lowOnly ? lowMaterials : materials;

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <h1>Materialen</h1>
          <p className="muted">
            Live voorraad van je grondstoffen. Word gewaarschuwd voor je zonder
            valt.
          </p>
        </div>
        <div className="header-actions">
          <Link href="/materials/quote" className="btn-ghost btn-ghost--dark">
            Offertecalculator
          </Link>
          <Link href="/materials/new" className="btn-primary">
            + Nieuw materiaal
          </Link>
        </div>
      </header>

      <div className="tabs">
        <Link
          href="/materials"
          className={`tab ${!lowOnly && !includeInactive ? "tab--active" : ""}`}
        >
          Alle actief
          <span className="tab-count">{materials.length}</span>
        </Link>
        <Link
          href="/materials?filter=low"
          className={`tab ${lowOnly ? "tab--active" : ""}`}
        >
          Lage voorraad
          <span className="tab-count">{lowMaterials.length}</span>
        </Link>
        <Link
          href="/materials?show=all"
          className={`tab ${includeInactive ? "tab--active" : ""}`}
        >
          Incl. inactief
        </Link>
        <form className="tab-search" action="/materials">
          {lowOnly && <input type="hidden" name="filter" value="low" />}
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam of SKU"
            defaultValue={search}
          />
        </form>
      </div>

      {shown.length === 0 ? (
        <div className="panel">
          <p className="muted">
            {lowOnly
              ? "Geen materialen onder het bestelpunt. 👍"
              : "Geen materialen gevonden."}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Naam</th>
                <th>Categorie</th>
                <th>Voorraad</th>
                <th>Bestelpunt</th>
                <th>Eenheidskost</th>
                <th>Leverancier</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const low = new Prisma.Decimal(m.stockQuantity).lte(
                  m.reorderLevel,
                );
                return (
                  <tr key={m.id}>
                    <td>
                      <Link
                        href={`/materials/${m.id}`}
                        className="link-strong"
                      >
                        {m.sku}
                      </Link>
                    </td>
                    <td>{m.name}</td>
                    <td className="muted small">
                      {CATEGORY_LABELS[m.category]}
                    </td>
                    <td>
                      <span className={low ? "stock-low" : ""}>
                        {Number(m.stockQuantity)} {m.unit}
                      </span>
                      {low && <span className="stock-flag">laag</span>}
                    </td>
                    <td className="muted small">
                      {Number(m.reorderLevel)} {m.unit}
                    </td>
                    <td>{formatEUR(m.unitCost.toString())}</td>
                    <td className="muted small">
                      {m.currentSupplier?.name ?? "—"}
                    </td>
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
