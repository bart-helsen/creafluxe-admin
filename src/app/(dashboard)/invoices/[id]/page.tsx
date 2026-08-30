import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR, formatDate } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import {
  issueInvoiceAction,
  setInvoiceStatusAction,
  saveDexxterRefAction,
} from "@/lib/dashboard-actions";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      order: true,
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!invoice) notFound();

  const totals = computeInvoiceTotals(
    invoice.lines.map((l) => ({
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      vatRate: l.vatRate,
    })),
  );
  const isDraft = invoice.status === "DRAFT";

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/invoices" className="muted small">
            ← Facturen
          </Link>
          <h1>
            Factuur {invoice.invoiceNumber ?? "(concept)"}{" "}
            <span className="status-pill">{invoice.status}</span>
          </h1>
          <p className="muted">
            Bestelling{" "}
            <Link href={`/orders/${invoice.orderId}`}>
              #{invoice.order.orderNumber}
            </Link>{" "}
            · {invoice.customer.name}
          </p>
        </div>
        <a
          href={`/invoices/${invoice.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn-primary"
        >
          PDF openen
        </a>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2>Factuurlijnen</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Aantal</th>
                    <th>Prijs</th>
                    <th>Btw</th>
                    <th>Totaal</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td>{l.quantity}</td>
                      <td>{formatEUR(l.unitPrice.toString())}</td>
                      <td>{Number(l.vatRate)}%</td>
                      <td>{formatEUR(l.lineTotal.toString())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="totals-box">
              <div className="totals-line">
                <span>Subtotaal (excl. btw)</span>
                <span>{formatEUR(totals.subtotal)}</span>
              </div>
              {totals.vatByRate.map((b) => (
                <div className="totals-line" key={b.vatRate}>
                  <span>Btw {Number(b.vatRate)}%</span>
                  <span>{formatEUR(b.vat)}</span>
                </div>
              ))}
              <div className="totals-line totals-line--strong">
                <span>Totaal (incl. btw)</span>
                <span>{formatEUR(totals.total)}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel">
            <h2>Afhandeling</h2>
            {isDraft ? (
              <>
                <p className="small muted">
                  Dit is een concept. Controleer het, maak de factuur in Dexxter
                  en geef ze hier uit om een gapless factuurnummer toe te kennen.
                </p>
                <form action={issueInvoiceAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <button type="submit" className="btn-primary">
                    Factuur uitgeven (nummer toekennen)
                  </button>
                </form>
              </>
            ) : (
              <div className="stack">
                <div>
                  <span className="muted small">Factuurdatum</span>
                  <div>{formatDate(invoice.issueDate)}</div>
                </div>
                <div>
                  <span className="muted small">Vervaldatum</span>
                  <div>{formatDate(invoice.dueDate)}</div>
                </div>
                <form action={setInvoiceStatusAction} className="stack-form">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <select name="status" defaultValue={invoice.status}>
                    <option value="SENT">Verstuurd</option>
                    <option value="PAID">Betaald</option>
                    <option value="OVERDUE">Vervallen</option>
                    <option value="CANCELLED">Geannuleerd</option>
                  </select>
                  <button type="submit" className="btn-ghost btn-ghost--dark">
                    Status opslaan
                  </button>
                </form>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Dexxter-referentie</h2>
            <p className="small muted">
              Plak hier het Dexxter-factuurnummer zodra je ze daar hebt
              aangemaakt, zodat beide systemen overeenkomen.
            </p>
            <form action={saveDexxterRefAction} className="stack-form">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input
                name="dexxterRef"
                placeholder="bv. 2026/123"
                defaultValue={invoice.dexxterRef ?? ""}
              />
              <button type="submit" className="btn-ghost btn-ghost--dark">
                Opslaan
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
