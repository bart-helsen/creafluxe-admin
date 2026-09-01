import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { computeCustomQuote } from "@/server/materials/costing";

// Custom-quote calculator (Phase 2b, docs/11). Pick materials + rough quantities
// and your estimated hours; the app adds material cost (from each material's
// current unitCost) + labour (hourlyRate × hours) + markup to propose a figure.
// You still decide the final number — this starts you from real, current costs.
//
// It's a GET form (no client JS): the chosen rows come back in the query string
// and the calculation runs server-side, so a result is bookmarkable/shareable.

const ROWS = 6;

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function QuoteCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{
    materialId?: string | string[];
    quantity?: string | string[];
    hours?: string;
  }>;
}) {
  const sp = await searchParams;
  const ids = asArray(sp.materialId);
  const qtys = asArray(sp.quantity);
  const hours = Number(sp.hours ?? "") || 0;

  const materials = await prisma.material.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, unit: true },
  });

  const lines = ids
    .map((materialId, i) => ({ materialId, quantity: qtys[i] ?? "0" }))
    .filter((l) => l.materialId && Number(l.quantity) > 0);

  const hasInput = lines.length > 0 || hours > 0;
  const quote = hasInput
    ? await computeCustomQuote({ lines, hours })
    : null;

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/materials" className="muted small">
          ← Materialen
        </Link>
        <h1>Offertecalculator</h1>
        <p className="muted">
          Kies materialen en geschatte uren; de app rekent kostprijs, arbeid en
          marge samen tot een richtprijs.
        </p>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2>Invoer</h2>
            <form action="/materials/quote" className="quote-form">
              {Array.from({ length: ROWS }).map((_, i) => (
                <div key={i} className="quote-row">
                  <select name="materialId" defaultValue={ids[i] ?? ""}>
                    <option value="">— materiaal —</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    name="quantity"
                    inputMode="decimal"
                    placeholder="aantal"
                    defaultValue={qtys[i] ?? ""}
                  />
                </div>
              ))}
              <label className="field quote-hours">
                Geschatte uren arbeid
                <input
                  name="hours"
                  inputMode="decimal"
                  defaultValue={hours || ""}
                  placeholder="bv. 1.5"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Bereken
                </button>
                <Link
                  href="/materials/quote"
                  className="btn-ghost btn-ghost--dark"
                >
                  Wissen
                </Link>
              </div>
            </form>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel">
            <h2>Richtprijs</h2>
            {!quote ? (
              <p className="muted small">
                Kies materialen en/of uren en klik op Bereken.
              </p>
            ) : (
              <>
                {quote.lines.length > 0 && (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Materiaal</th>
                          <th>Aantal</th>
                          <th>Kost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.lines.map((l) => (
                          <tr key={l.materialId}>
                            <td>{l.name}</td>
                            <td>
                              {l.quantity} {l.unit}
                            </td>
                            <td>{formatEUR(l.lineCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="totals-box">
                  <div className="totals-line">
                    <span>Materiaalkost</span>
                    <span>{formatEUR(quote.materialCost)}</span>
                  </div>
                  <div className="totals-line">
                    <span>
                      Arbeid ({quote.hours} u × {formatEUR(quote.hourlyRate)})
                    </span>
                    <span>{formatEUR(quote.labourCost)}</span>
                  </div>
                  <div className="totals-line">
                    <span>Subtotaal</span>
                    <span>{formatEUR(quote.subtotal)}</span>
                  </div>
                  <div className="totals-line totals-line--strong">
                    <span>Richtprijs (+{quote.markupPercent}% marge)</span>
                    <span>{formatEUR(quote.suggestedPrice)}</span>
                  </div>
                </div>
                <p className="muted small">
                  Alle bedragen excl. btw. Jij bepaalt de eindprijs.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
