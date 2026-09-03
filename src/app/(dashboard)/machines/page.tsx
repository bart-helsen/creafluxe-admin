import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { computeMachineRates, formatPerMinute } from "@/lib/machine-cost";

// Machines list (production equipment). Each row shows the DERIVED usage cost —
// per hour and per minute — worked out from the machine's own depreciation,
// energy and maintenance figures. The product cost calculator uses the same
// numbers to price the machine time a product needs.

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const { q, show } = await searchParams;
  const search = (q ?? "").trim();
  const includeInactive = show === "all";

  const machines = await prisma.machine.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(search
        ? { name: { contains: search, mode: "insensitive" } }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 400,
  });

  const rows = machines.map((m) => ({ machine: m, rates: computeMachineRates(m) }));

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <h1>Machines</h1>
          <p className="muted">
            Je productiemachines met hun berekende gebruikskost per uur en per
            minuut (afschrijving + energie + onderhoud).
          </p>
        </div>
        <div className="header-actions">
          <Link href="/product-cost" className="btn-ghost btn-ghost--dark">
            Kostprijscalculator
          </Link>
          <Link href="/machines/new" className="btn-primary">
            + Nieuwe machine
          </Link>
        </div>
      </header>

      <div className="tabs">
        <Link
          href="/machines"
          className={`tab ${!includeInactive ? "tab--active" : ""}`}
        >
          Actief
          <span className="tab-count">{machines.length}</span>
        </Link>
        <Link
          href="/machines?show=all"
          className={`tab ${includeInactive ? "tab--active" : ""}`}
        >
          Incl. inactief
        </Link>
        <form className="tab-search" action="/machines">
          {includeInactive && <input type="hidden" name="show" value="all" />}
          <input
            type="search"
            name="q"
            placeholder="Zoek op naam"
            defaultValue={search}
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="panel">
          <p className="muted">
            Nog geen machines. Voeg er een toe om de gebruikskost te berekenen.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Aankoop</th>
                <th>Levensduur</th>
                <th>Vermogen</th>
                <th>Kost / uur</th>
                <th>Kost / minuut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ machine: m, rates }) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/machines/${m.id}`} className="link-strong">
                      {m.name}
                    </Link>
                    {!m.active && (
                      <span className="status-pill" style={{ marginLeft: 8 }}>
                        Inactief
                      </span>
                    )}
                  </td>
                  <td>{formatEUR(m.purchasePrice.toString())}</td>
                  <td className="muted small">{Number(m.lifetimeHours)} u</td>
                  <td className="muted small">{Number(m.powerKw)} kW</td>
                  <td>{formatEUR(rates.costPerHour)}</td>
                  <td>{formatPerMinute(rates.costPerMinute)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
