import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR, formatDate } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/invoices/invoiceMath";
import {
  issueInvoiceAction,
  setInvoiceStatusAction,
  saveDexxterRefAction,
  deleteDraftInvoiceAction,
  cancelInvoiceAction,
  saveCreditNoteDexxterRefAction,
} from "@/lib/dashboard-actions";
import ActionForm, { SubmitButton } from "@/components/ActionForm";

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
      creditNote: true,
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
  const isCancelled = invoice.status === "CANCELLED";
  const creditNote = invoice.creditNote;
  // Old-style cancellation (status only, before credit notes existed).
  const needsCreditNote = isCancelled && !creditNote && !!invoice.invoiceNumber;

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
                {!isCancelled && (
                  <form action={setInvoiceStatusAction} className="stack-form">
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <select name="status" defaultValue={invoice.status}>
                      <option value="ISSUED">Uitgegeven</option>
                      <option value="SENT">Verstuurd</option>
                      <option value="PAID">Betaald</option>
                      <option value="OVERDUE">Vervallen</option>
                    </select>
                    <button type="submit" className="btn-ghost btn-ghost--dark">
                      Status opslaan
                    </button>
                  </form>
                )}
              </div>
            )}
          </section>

          {isDraft && (
            <section className="panel">
              <h2>Concept verwijderen</h2>
              <p className="small muted">
                Een concept heeft nog geen nummer, dus je kan het veilig
                verwijderen. De bestelling blijft ongewijzigd; je kan daar
                later een nieuw concept aanmaken.
              </p>
              <ActionForm
                action={deleteDraftInvoiceAction}
                className="stack-form"
                confirm="Dit concept definitief verwijderen? De bestelling blijft bestaan."
              >
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <SubmitButton className="btn-link-danger" pendingLabel="Verwijderen…">
                  Concept verwijderen
                </SubmitButton>
              </ActionForm>
            </section>
          )}

          {!isDraft && !isCancelled && (
            <section className="panel">
              <h2>Factuur annuleren</h2>
              <p className="small muted">
                Een uitgegeven factuur kan niet verwijderd worden. Annuleren maakt
                een creditnota (eigen nummerreeks) die deze factuur volledig
                crediteert. Daarna kan je op de bestelling een nieuw concept maken.
                Maak dezelfde creditnota ook in Dexxter.
              </p>
              {invoice.status === "PAID" && (
                <p className="small form-error">
                  Deze factuur is al betaald — vergeet de klant niet terug te betalen.
                </p>
              )}
              <ActionForm
                action={cancelInvoiceAction}
                className="stack-form"
                confirm={`Factuur ${invoice.invoiceNumber} annuleren met een creditnota? Dit krijgt een definitief nummer en kan niet ongedaan gemaakt worden.`}
              >
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input name="reason" placeholder="Reden (komt op de creditnota)" maxLength={500} />
                <SubmitButton className="btn-link-danger" pendingLabel="Creditnota maken…">
                  Annuleren met creditnota
                </SubmitButton>
              </ActionForm>
            </section>
          )}

          {creditNote && (
            <section className="panel">
              <h2>Creditnota {creditNote.creditNoteNumber}</h2>
              <p className="stack small">
                <span>
                  {formatDate(creditNote.issueDate)} ·{" "}
                  {formatEUR(creditNote.total.negated().toString())}
                </span>
                {creditNote.reason && <span className="muted">Reden: {creditNote.reason}</span>}
                <a
                  href={`/credit-notes/${creditNote.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-strong"
                >
                  Creditnota-PDF openen →
                </a>
                <Link href={`/orders/${invoice.orderId}`} className="link-strong">
                  Nieuwe factuur maken via de bestelling →
                </Link>
              </p>
              <form action={saveCreditNoteDexxterRefAction} className="stack-form">
                <input type="hidden" name="creditNoteId" value={creditNote.id} />
                <input
                  name="dexxterRef"
                  placeholder="Dexxter-creditnotanummer, bv. 2026-1"
                  defaultValue={creditNote.dexxterRef ?? ""}
                />
                <button type="submit" className="btn-ghost btn-ghost--dark">
                  Opslaan
                </button>
              </form>
            </section>
          )}

          {needsCreditNote && (
            <section className="panel">
              <h2>Creditnota ontbreekt</h2>
              <p className="small muted">
                Deze factuur werd geannuleerd zonder creditnota. Maak die hier
                alsnog aan, zodat de annulering correct is.
              </p>
              <ActionForm
                action={cancelInvoiceAction}
                className="stack-form"
                confirm={`Creditnota maken voor factuur ${invoice.invoiceNumber}?`}
              >
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input name="reason" placeholder="Reden (komt op de creditnota)" maxLength={500} />
                <SubmitButton pendingLabel="Creditnota maken…">Creditnota aanmaken</SubmitButton>
              </ActionForm>
            </section>
          )}

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
