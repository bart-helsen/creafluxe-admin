import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR, formatDate, formatDateTime } from "@/lib/money";
import { channelLabel } from "@/lib/manual-order";
import { isR2Configured, presignDownload } from "@/lib/r2";
import {
  MANUAL_REQUEST_STATUSES,
  OFFER_STATUS_LABELS,
  REQUEST_EVENT_LABELS,
  REQUEST_STATUS_LABELS,
  formatRequestNumber,
  requestTitle,
} from "@/lib/requests";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import {
  changeRequestStatusAction,
  createOfferAction,
  deleteRequestFileAction,
  logRequestEventAction,
  updateRequestDetailsAction,
  uploadRequestFileAction,
} from "@/lib/request-actions";

// One custom request: what the customer asked, their files, the back-and-forth
// (questions / answers / notes), and the offers you made. Accepting an offer
// (on the offer page) turns it into a normal order.

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const request = await prisma.quoteRequest.findUnique({
    where: { id },
    include: {
      customer: true,
      order: { select: { id: true, orderNumber: true, status: true } },
      offers: { orderBy: { version: "desc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" }, include: { user: true } },
    },
  });
  if (!request) notFound();

  const r2On = isR2Configured();
  const files = await Promise.all(
    request.attachments.map(async (f) => ({
      ...f,
      url: r2On ? await presignDownload(f.storageKey) : null,
    })),
  );

  const number = formatRequestNumber(request.requestNumber);
  const title = requestTitle(request);
  const accepted = request.status === "ACCEPTED" || !!request.order;
  const latestOffer = request.offers[0];
  const delivery = request.deliveryRequested
    ? [
        request.deliveryStreet,
        [request.deliveryPostal, request.deliveryCity].filter(Boolean).join(" "),
        request.deliveryCountry,
        request.deliveryNotes,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Afhaling";

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/requests" className="muted small">
            ← Aanvragen
          </Link>
          <h1>
            Aanvraag {number} <span className="muted">· {title}</span>
          </h1>
          <p className="muted">
            via {channelLabel(request.channel, true).toLowerCase()} · ontvangen{" "}
            {formatDateTime(request.createdAt)} ·{" "}
            <span className={`status-pill status-pill--${request.status.toLowerCase()}`}>
              {REQUEST_STATUS_LABELS[request.status]}
            </span>
          </p>
        </div>
        <div className="header-actions">
          {request.order ? (
            <Link href={`/orders/${request.order.id}`} className="btn-primary">
              Bestelling #{request.order.orderNumber} openen →
            </Link>
          ) : (
            <ActionForm action={createOfferAction} className="inline-actions">
              <input type="hidden" name="requestId" value={request.id} />
              <SubmitButton pendingLabel="Aanmaken…">+ Nieuwe offerte</SubmitButton>
            </ActionForm>
          )}
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {/* The brief */}
          <section className="panel">
            <h2>Wat vraagt de klant?</h2>
            <p className="prewrap">{request.description}</p>
            {request.customerRemarks && (
              <div className="brief">
                <h3>Opmerkingen</h3>
                <p className="prewrap">{request.customerRemarks}</p>
              </div>
            )}
            {!accepted && (
              <details className="inline-details">
                <summary>Omschrijving aanpassen</summary>
                <ActionForm action={updateRequestDetailsAction} className="stack-form">
                  <input type="hidden" name="requestId" value={request.id} />
                  <label className="field">
                    Korte titel (komt als &quot;Betreft&quot; op de offerte)
                    <input name="title" defaultValue={request.title ?? ""} placeholder={title} />
                  </label>
                  <label className="field">
                    Omschrijving
                    <textarea name="description" rows={6} defaultValue={request.description} />
                  </label>
                  <label className="field">
                    Opmerkingen
                    <textarea
                      name="customerRemarks"
                      rows={2}
                      defaultValue={request.customerRemarks ?? ""}
                    />
                  </label>
                  <SubmitButton pendingLabel="Opslaan…">Opslaan</SubmitButton>
                </ActionForm>
              </details>
            )}
          </section>

          {/* Offers */}
          <section className="panel">
            <h2>Offertes</h2>
            {request.offers.length === 0 ? (
              <p className="muted small">
                Nog geen offerte. Klaar met bekijken en eventuele vragen? Maak een offerte: je
                rekent materiaal, machinetijd en uren door en kiest de prijs.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nummer</th>
                      <th>Status</th>
                      <th>Totaal</th>
                      <th>Kostprijs</th>
                      <th>Datum</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {request.offers.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/offers/${o.id}`} className="link-strong">
                            {o.offerNumber}
                          </Link>
                          {o.version > 1 && <div className="muted small">versie {o.version}</div>}
                        </td>
                        <td>
                          <span className={`status-pill status-pill--offer-${o.status.toLowerCase()}`}>
                            {OFFER_STATUS_LABELS[o.status]}
                          </span>
                        </td>
                        <td>{formatEUR(o.total.toString())}</td>
                        <td className="muted small">
                          {o.costTotal ? formatEUR(o.costTotal.toString()) : "—"}
                        </td>
                        <td className="muted small">
                          {o.sentAt ? `verstuurd ${formatDate(o.sentAt)}` : formatDate(o.createdAt)}
                        </td>
                        <td className="row-action">
                          <a href={`/offers/${o.id}/pdf`} target="_blank" rel="noreferrer" className="btn-link">
                            PDF
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!accepted && latestOffer && latestOffer.status !== "DRAFT" && (
              <p className="muted small">
                Wil de klant iets anders? Open de offerte en kies <em>Nieuwe versie</em>, of maak
                hierboven een volledig nieuwe offerte.
              </p>
            )}
          </section>

          {/* Files */}
          <section className="panel">
            <h2>Bestanden</h2>
            {files.length === 0 ? (
              <p className="muted small">
                Nog geen bestanden. Bestanden die de klant via het Atelier meestuurt, komen
                voorlopig via de offerte-mail binnen — voeg ze hier toe om alles bij elkaar te
                houden.
              </p>
            ) : (
              <div className="files files--stacked">
                {files.map((f) => (
                  <div key={f.id} className="file-row">
                    <span className="file-chip">
                      <span className="file-kind">UPLOAD</span>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer">
                          {f.label ?? f.fileName}
                        </a>
                      ) : (
                        <span title={f.storageKey}>{f.label ?? f.fileName}</span>
                      )}
                    </span>
                    {f.orderItemId ? (
                      <span className="muted small">bij de bestelling</span>
                    ) : (
                      <ActionForm action={deleteRequestFileAction} className="inline-actions">
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="requestId" value={request.id} />
                        <SubmitButton className="btn-link-danger" pendingLabel="…">
                          Verwijderen
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!accepted &&
              (r2On ? (
                <ActionForm action={uploadRequestFileAction} className="inline-form" resetOnSuccess>
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="file" name="file" required />
                  <input name="label" placeholder="Omschrijving (optioneel)" />
                  <SubmitButton className="btn-ghost btn-ghost--dark" pendingLabel="Uploaden…">
                    Uploaden
                  </SubmitButton>
                </ActionForm>
              ) : (
                <p className="muted small">
                  Bestandsopslag (R2) is niet ingesteld, dus uploaden kan hier nog niet.
                </p>
              ))}
          </section>

          {/* Timeline + communication */}
          <section className="panel">
            <h2>Tijdlijn &amp; communicatie</h2>
            <ActionForm action={logRequestEventAction} className="stack-form log-form" resetOnSuccess>
              <input type="hidden" name="requestId" value={request.id} />
              <div className="calc-row">
                <select name="kind" defaultValue="QUESTION" aria-label="Soort">
                  <option value="QUESTION">Vraag aan klant</option>
                  <option value="ANSWER">Antwoord van klant</option>
                  <option value="NOTE">Interne notitie</option>
                </select>
              </div>
              <textarea
                name="note"
                rows={3}
                placeholder="Wat vroeg je aan de klant, wat antwoordde die, of een notitie voor jezelf…"
                required
              />
              <SubmitButton pendingLabel="Toevoegen…">Toevoegen</SubmitButton>
              <p className="muted small">
                Een vraag zet de aanvraag op &quot;Wacht op klant&quot;; een antwoord zet ze terug
                op &quot;In behandeling&quot;.
              </p>
            </ActionForm>

            <ol className="timeline">
              {request.events.map((e) => (
                <li key={e.id} className={`timeline-item timeline-item--${e.kind.toLowerCase()}`}>
                  <div className="timeline-dot" />
                  <div>
                    <strong>{REQUEST_EVENT_LABELS[e.kind]}</strong>
                    {e.toStatus && e.fromStatus && e.fromStatus !== e.toStatus && (
                      <span className="muted small">
                        {" "}
                        · {REQUEST_STATUS_LABELS[e.fromStatus]} → {REQUEST_STATUS_LABELS[e.toStatus]}
                      </span>
                    )}
                    <div className="muted small">
                      {formatDateTime(e.createdAt)}
                      {e.user ? ` · ${e.user.name ?? e.user.email}` : ""}
                    </div>
                    {e.note && <div className="small prewrap">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel">
            <h2>Klant</h2>
            <p className="stack">
              {request.customer.companyName && <strong>{request.customer.companyName}</strong>}
              <span>{request.customer.name}</span>
              <Link href={`/customers/${request.customer.id}`} className="link-strong">
                Klantfiche →
              </Link>
              {request.customer.email && (
                <a href={`mailto:${request.customer.email}?subject=${encodeURIComponent(`Je aanvraag bij Creafluxe (${number})`)}`}>
                  {request.customer.email}
                </a>
              )}
              {request.customer.phone && <span>{request.customer.phone}</span>}
              {request.customer.isBusiness && (
                <span className="muted small">
                  Onderneming{request.customer.vatNumber ? ` · ${request.customer.vatNumber}` : ""}
                </span>
              )}
            </p>
            <h3>Levering</h3>
            <p className="small">{delivery}</p>
          </section>

          <section className="panel">
            <h2>Status</h2>
            {accepted ? (
              <p className="small">
                Offerte aanvaard — deze aanvraag loopt verder als{" "}
                {request.order ? (
                  <Link href={`/orders/${request.order.id}`} className="link-strong">
                    bestelling #{request.order.orderNumber}
                  </Link>
                ) : (
                  "bestelling"
                )}
                .
              </p>
            ) : (
              <ActionForm action={changeRequestStatusAction} className="stack-form">
                <input type="hidden" name="requestId" value={request.id} />
                <select name="status" defaultValue={request.status}>
                  {MANUAL_REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {REQUEST_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <input name="note" placeholder="Notitie (optioneel)" />
                <SubmitButton pendingLabel="Opslaan…">Status opslaan</SubmitButton>
                <p className="muted small">
                  Kies <em>Afgewezen</em> of <em>Geannuleerd</em> om een aanvraag zonder bestelling
                  af te sluiten.
                </p>
              </ActionForm>
            )}
          </section>

          {!accepted && (
            <section className="panel">
              <h2>Zo werkt het</h2>
              <ol className="steps small">
                <li>Bekijk de aanvraag; stel vragen en noteer de antwoorden in de tijdlijn.</li>
                <li>Maak een offerte: materiaal, machinetijd en uren → jouw prijs.</li>
                <li>Download de PDF, stuur hem naar de klant en markeer als verstuurd.</li>
                <li>Akkoord? Klik op <em>Klant aanvaardt</em> — het wordt een bestelling.</li>
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
