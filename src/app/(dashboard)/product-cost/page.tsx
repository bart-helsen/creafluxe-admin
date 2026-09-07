import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { formatPerMinute } from "@/lib/machine-cost";
import { computeProductBuildCost } from "@/server/materials/costing";
import { promoteToCatalogueAction } from "@/lib/catalogue-actions";

// Product cost calculator (docs: Machine model). Work out what a new product
// costs to make — machine time + materials + design/post-production labour — and
// see a suggested price you stay in full control of.
//
// Like the offer calculator it's a GET form (no client JS): your inputs come
// back in the query string and the sum runs server-side, so a result is
// bookmarkable and shareable.

const MATERIAL_ROWS = 6;

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function ProductCostPage({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    machineId?: string;
    machineMinutes?: string;
    materialId?: string | string[];
    quantity?: string | string[];
    hours?: string;
    finalPrice?: string;
    finalPriceVat?: string; // "incl" | "excl"
    vatRate?: string;
  }>;
}) {
  const sp = await searchParams;
  const name = (sp.name ?? "").trim();
  const machineId = sp.machineId ?? "";
  const machineMinutes = Number(sp.machineMinutes ?? "") || 0;
  const ids = asArray(sp.materialId);
  const qtys = asArray(sp.quantity);
  const hours = Number(sp.hours ?? "") || 0;
  const finalPrice = sp.finalPrice != null && sp.finalPrice !== ""
    ? Number(sp.finalPrice)
    : null;
  const finalPriceInclVat = sp.finalPriceVat === "incl";
  const vatRate = Number(sp.vatRate ?? "") || 21;

  const [machines, materials] = await Promise.all([
    prisma.machine.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.material.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true },
    }),
  ]);

  const lines = ids
    .map((materialId, i) => ({ materialId, quantity: qtys[i] ?? "0" }))
    .filter((l) => l.materialId && Number(l.quantity) > 0);

  const hasInput =
    (machineId && machineMinutes > 0) || lines.length > 0 || hours > 0;
  const result = hasInput
    ? await computeProductBuildCost({
        machineId: machineId || null,
        machineMinutes,
        lines,
        hours,
        finalPrice,
        finalPriceInclVat,
        vatRate,
      })
    : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Kostprijscalculator</h1>
        <p className="muted">
          Bereken de productiekost van een nieuw product: machinetijd,
          materiaal en arbeid. Jij bepaalt de eindprijs.
        </p>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2>Invoer</h2>
            <form action="/product-cost" className="calc-form">
              <label className="field">
                Productnaam
                <input
                  name="name"
                  placeholder="bv. Heup flacon (leer)"
                  defaultValue={name}
                />
              </label>

              <h3>Machine</h3>
              <div className="calc-row">
                <select name="machineId" defaultValue={machineId}>
                  <option value="">— geen machine —</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  name="machineMinutes"
                  inputMode="decimal"
                  placeholder="minuten"
                  defaultValue={sp.machineMinutes ?? ""}
                />
              </div>
              {machines.length === 0 && (
                <p className="muted small">
                  Nog geen machines.{" "}
                  <Link href="/machines/new" className="link-strong">
                    Voeg er een toe
                  </Link>{" "}
                  om machinetijd mee te rekenen.
                </p>
              )}

              <h3>Materiaal</h3>
              {Array.from({ length: MATERIAL_ROWS }).map((_, i) => (
                <div key={i} className="calc-row">
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

              <h3>Arbeid</h3>
              <label className="field calc-narrow">
                Uren ontwerp + nabewerking
                <input
                  name="hours"
                  inputMode="decimal"
                  placeholder="bv. 1.5"
                  defaultValue={hours || ""}
                />
              </label>

              <h3>Eindprijs</h3>
              <label className="field calc-narrow">
                Btw-tarief (%)
                <input
                  name="vatRate"
                  inputMode="decimal"
                  placeholder="21"
                  defaultValue={sp.vatRate ?? "21"}
                />
              </label>
              <label className="field calc-narrow">
                Jouw eindprijs (optioneel)
                <div className="calc-row">
                  <input
                    name="finalPrice"
                    inputMode="decimal"
                    placeholder="bv. 25.00"
                    defaultValue={sp.finalPrice ?? ""}
                  />
                  <select
                    name="finalPriceVat"
                    defaultValue={sp.finalPriceVat ?? "excl"}
                  >
                    <option value="excl">excl. btw</option>
                    <option value="incl">incl. btw</option>
                  </select>
                </div>
              </label>
              <p className="muted small">
                Kies <strong>excl. btw</strong> voor een ronde nettoprijs (B2B),
                of <strong>incl. btw</strong> voor een ronde verkoopprijs (B2C).
              </p>

              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Bereken
                </button>
                <Link href="/product-cost" className="btn-ghost btn-ghost--dark">
                  Wissen
                </Link>
              </div>
            </form>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel">
            <h2>Kostprijs{name ? ` — ${name}` : ""}</h2>
            {!result ? (
              <p className="muted small">
                Kies een machine, materialen en/of uren en klik op Bereken.
              </p>
            ) : (
              <>
                {result.materialLines.length > 0 && (
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
                        {result.materialLines.map((l) => (
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

                <div className="totals-box" style={{ marginLeft: 0, maxWidth: "none" }}>
                  {result.machine && (
                    <div className="totals-line">
                      <span>
                        Machine ({result.machineMinutes} min ×{" "}
                        {formatPerMinute(result.machine.costPerMinute)})
                      </span>
                      <span>{formatEUR(result.machineCost)}</span>
                    </div>
                  )}
                  <div className="totals-line">
                    <span>Materiaalkost</span>
                    <span>{formatEUR(result.materialCost)}</span>
                  </div>
                  <div className="totals-line">
                    <span>
                      Arbeid ({result.hours} u × {formatEUR(result.hourlyRate)})
                    </span>
                    <span>{formatEUR(result.labourCost)}</span>
                  </div>
                  <div className="totals-line totals-line--strong">
                    <span>Kostprijs (excl. btw)</span>
                    <span>{formatEUR(result.totalCost)}</span>
                  </div>
                  <div className="totals-line">
                    <span>Richtprijs (+{result.markupPercent}% marge)</span>
                    <span>
                      {formatEUR(result.suggestedPrice)}
                      <span className="muted small">
                        {" "}
                        · {formatEUR(result.suggestedPriceIncl)} incl. btw
                      </span>
                    </span>
                  </div>
                  <div className="totals-line">
                    <span>Afgerond</span>
                    <span>
                      {formatEUR(result.roundedPrice)}
                      <span className="muted small">
                        {" "}
                        · {formatEUR(result.roundedPriceIncl)} incl. btw
                      </span>
                    </span>
                  </div>
                </div>

                {result.finalPrice && (
                  <div className="totals-box" style={{ marginLeft: 0, maxWidth: "none" }}>
                    <div className="totals-line totals-line--strong">
                      <span>Jouw eindprijs (excl. btw)</span>
                      <span>{formatEUR(result.finalPrice)}</span>
                    </div>
                    <div className="totals-line">
                      <span>Incl. {result.vatRate}% btw</span>
                      <span>{formatEUR(result.finalPriceIncl!)}</span>
                    </div>
                    <div className="totals-line">
                      <span>Marge (op nettoprijs)</span>
                      <span
                        className={
                          Number(result.margin) < 0 ? "stock-low" : undefined
                        }
                      >
                        {formatEUR(result.margin!)}
                        {result.marginPercent != null &&
                          ` (${result.marginPercent}%)`}
                      </span>
                    </div>
                  </div>
                )}

                <p className="muted small">
                  Kostprijs en marge zijn excl. btw. Je koos je eindprijs{" "}
                  {finalPriceInclVat ? "incl." : "excl."} btw; beide bedragen
                  staan hierboven.
                </p>

                {/* Promote to the catalogue. Carries the current inputs so the
                    server action can recompute and store them. */}
                <div className="promote-box" style={{ marginTop: "1rem" }}>
                  <h3>Naar catalogus</h3>
                  {name ? (
                    <form
                      action={promoteToCatalogueAction}
                      className="stack-form"
                    >
                      <input type="hidden" name="name" value={name} />
                      <input
                        type="hidden"
                        name="machineId"
                        value={machineId}
                      />
                      <input
                        type="hidden"
                        name="machineMinutes"
                        value={sp.machineMinutes ?? ""}
                      />
                      <input type="hidden" name="hours" value={hours || ""} />
                      <input
                        type="hidden"
                        name="finalPrice"
                        value={sp.finalPrice ?? ""}
                      />
                      <input
                        type="hidden"
                        name="finalPriceVat"
                        value={sp.finalPriceVat ?? "excl"}
                      />
                      <input
                        type="hidden"
                        name="vatRate"
                        value={sp.vatRate ?? "21"}
                      />
                      {lines.flatMap((l, i) => [
                        <input
                          key={`m${i}`}
                          type="hidden"
                          name="materialId"
                          value={l.materialId}
                        />,
                        <input
                          key={`q${i}`}
                          type="hidden"
                          name="quantity"
                          value={l.quantity}
                        />,
                      ])}
                      <label className="field">
                        SKU voor de catalogus *
                        <input name="sku" placeholder="bv. HEUP-LEER" required />
                      </label>
                      <button type="submit" className="btn-primary">
                        Promoveer naar catalogus
                      </button>
                      <p className="muted small">
                        Maakt een catalogusproduct aan — verborgen in de webshop
                        tot je dat zelf aanzet — met de stuklijst en
                        kostberekening eraan gekoppeld. De basisprijs (incl.{" "}
                        {result.vatRate}% btw) volgt uit je eindprijs
                        {finalPriceInclVat
                          ? " (die je al incl. btw koos)"
                          : ", omgerekend van excl. naar incl. btw"}
                        ; achteraf aanpasbaar.
                      </p>
                    </form>
                  ) : (
                    <p className="muted small">
                      Geef bovenaan een productnaam in om dit resultaat naar de
                      catalogus te kunnen promoveren.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
