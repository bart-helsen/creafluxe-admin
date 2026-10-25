import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, formatEUR } from "@/lib/money";
import { todayInBrussels } from "@/lib/purchase-checks";
import {
  PURCHASE_STATUS_LABELS,
  VAT_TREATMENT_LABELS,
  countryLabel,
  purchaseTitle,
} from "@/lib/purchases";
import {
  VAT_RETURN_DEADLINE,
  isQuarter,
  previousQuarter,
  quarterDeadline,
  quarterOf,
  quarterRange,
  summarizeByTreatment,
  type Quarter,
} from "@/lib/purchase-quarter";
import { dateOnly, isoDate } from "@/server/purchases/purchaseInvoices";

// Quarter view: the purchases of one quarter, totals per VAT treatment, and a
// clear marker of what isn't in Dexxter yet — to cross-check Dexxter before you
// file. Grouped by invoice date. Not a VAT return: no grid numbers, no rules.

export default async function PurchaseQuarterPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const today = todayInBrussels();
  // Default: the quarter you are most likely filing — the previous one.
  const current = quarterOf(today);
  const fallback = previousQuarter(current.year, current.quarter);
  const year = Number(sp.year) >= 2000 && Number(sp.year) < 2100 ? Number(sp.year) : fallback.year;
  const quarter: Quarter = isQuarter(Number(sp.q)) ? (Number(sp.q) as Quarter) : fallback.quarter;
  const range = quarterRange(year, quarter);
  const deadline = quarterDeadline(year, quarter);

  const [invoices, undated] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: { invoiceDate: { gte: dateOnly(range.start)!, lt: dateOnly(range.endExclusive)! } },
      orderBy: [{ invoiceDate: "asc" }, { receivedAt: "asc" }],
    }),
    prisma.purchaseInvoice.count({ where: { invoiceDate: null } }),
  ]);

  const { rows, total } = summarizeByTreatment(
    invoices.map((p) => ({
      status: p.status,
      vatTreatment: p.vatTreatment,
      currency: p.currency,
      netAmount: p.netAmount?.toString() ?? null,
      vatAmount: p.vatAmount?.toString() ?? null,
      grossAmount: p.grossAmount?.toString() ?? null,
      amountEur: p.amountEur?.toString() ?? null,
    })),
  );
  const notUploaded = invoices.filter((p) => p.status !== "UPLOADED_TO_DEXXTER");
  const unchecked = invoices.filter((p) => p.status === "RECEIVED").length;
  const years = Array.from({ length: 4 }, (_, i) => current.year - i);

  const nav = (y: number, q: number) => `/purchases/quarter?year=${y}&q=${q}`;

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/purchases" className="muted small">
          ← Inkoopfacturen
        </Link>
        <h1>
          Kwartaaloverzicht · Q{quarter} {year}
        </h1>
        <p className="muted">
          {formatDate(range.start)} – {formatDate(range.lastDay)}, op factuurdatum. Om na te kijken
          tegen Dexxter vóór je btw-aangifte.
        </p>
      </header>

      <form className="tabs" action="/purchases/quarter">
        {[1, 2, 3, 4].map((q) => (
          <Link key={q} href={nav(year, q)} className={`tab ${q === quarter ? "tab--active" : ""}`}>
            Q{q}
          </Link>
        ))}
        <span className="tab-search">
          <select name="year" defaultValue={year} aria-label="Jaar">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <input type="hidden" name="q" value={quarter} />
          <button type="submit" className="btn-ghost btn-ghost--dark">
            Toon
          </button>
        </span>
      </form>

      <p className="disclaimer">
        Dit is een hulpmiddel om na te kijken, <strong>geen btw-aangifte</strong>. Bedragen en
        btw-behandeling zijn zoals jij ze ingaf; controleer alle cijfers in Dexxter of met je
        boekhouder. Uiterste indiendatum (herinnering): <strong>{formatDate(deadline)}</strong> —{" "}
        <em>verifieer in Dexxter</em> (instelling: dag {VAT_RETURN_DEADLINE.dayOfMonth},{" "}
        {VAT_RETURN_DEADLINE.monthsAfterQuarterEnd} maand na het kwartaal).
      </p>

      <section className="card-grid">
        <div className="stat-card">
          <span className="stat-label">Facturen</span>
          <span className="stat-value">{total.count}</span>
          <span className="stat-hint">in Q{quarter}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Nog niet in Dexxter</span>
          <span className={`stat-value ${notUploaded.length ? "stock-low" : ""}`}>{notUploaded.length}</span>
          <span className="stat-hint">
            {unchecked ? `waarvan ${unchecked} nog te controleren` : notUploaded.length ? "klaar voor het pakket" : "alles geüpload ✓"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Totaal bruto (EUR)</span>
          <span className="stat-value">{formatEUR(total.gross)}</span>
          <span className="stat-hint">netto {formatEUR(total.net)} · btw {formatEUR(total.vat)}</span>
        </div>
      </section>

      <section className="panel">
        <h2>Per btw-behandeling</h2>
        {rows.length === 0 ? (
          <p className="muted small">Geen inkoopfacturen met een factuurdatum in dit kwartaal.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Btw-behandeling</th>
                  <th>Aantal</th>
                  <th>Netto</th>
                  <th>Btw</th>
                  <th>Bruto</th>
                  <th>Nog niet in Dexxter</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.treatment}>
                    <td>{VAT_TREATMENT_LABELS[r.treatment]}</td>
                    <td>{r.count}</td>
                    <td className="nowrap">{formatEUR(r.net)}</td>
                    <td className="nowrap">{formatEUR(r.vat)}</td>
                    <td className="nowrap">
                      {formatEUR(r.gross)}
                      {r.convertedCount > 0 && <div className="muted small">{r.convertedCount}× omgerekend naar EUR</div>}
                      {r.missingEurCount > 0 && (
                        <div className="stock-low small">{r.missingEurCount}× zonder EUR-bedrag, niet meegeteld</div>
                      )}
                    </td>
                    <td className={r.notUploadedCount ? "stock-low" : "muted"}>{r.notUploadedCount || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Facturen</h2>
        {invoices.length === 0 ? (
          <p className="muted small">—</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Factuur</th>
                  <th>Land</th>
                  <th>Btw-behandeling</th>
                  <th>Netto</th>
                  <th>Btw</th>
                  <th>Bruto</th>
                  <th>Dexxter</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((p) => {
                  const money = (v: { toString(): string } | null) =>
                    v == null ? "—" : p.currency === "EUR" ? formatEUR(v.toString()) : `${p.currency} ${v.toString().replace(".", ",")}`;
                  return (
                    <tr key={p.id} className={p.status !== "UPLOADED_TO_DEXXTER" ? "row-attention" : ""}>
                      <td className="nowrap">{formatDate(isoDate(p.invoiceDate))}</td>
                      <td>
                        <Link href={`/purchases/${p.id}`} className="link-strong">
                          {purchaseTitle(p)}
                        </Link>
                      </td>
                      <td className="small">{countryLabel(p.supplierCountry)}</td>
                      <td className="small">{VAT_TREATMENT_LABELS[p.vatTreatment]}</td>
                      <td className="nowrap">{money(p.netAmount)}</td>
                      <td className="nowrap">{money(p.vatAmount)}</td>
                      <td className="nowrap">
                        {money(p.grossAmount)}
                        {p.currency !== "EUR" && p.amountEur && (
                          <div className="muted small">≈ {formatEUR(p.amountEur.toString())}</div>
                        )}
                      </td>
                      <td>
                        {p.status === "UPLOADED_TO_DEXXTER" ? (
                          <span className="status-pill status-pill--purchase-uploaded_to_dexxter">✓ In Dexxter</span>
                        ) : (
                          <span className={`status-pill status-pill--purchase-${p.status.toLowerCase()}`}>
                            ✗ {PURCHASE_STATUS_LABELS[p.status]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {undated > 0 && (
          <p className="muted small">
            {undated} factu{undated === 1 ? "ur" : "ren"} zonder factuurdatum staa{undated === 1 ? "t" : "n"} in geen
            enkel kwartaal —{" "}
            <Link href="/purchases?bucket=RECEIVED" className="link-strong">
              vul de datum in
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
