import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR, formatDate, formatDateTime } from "@/lib/money";
import { pricing } from "@/lib/pricing";
import { computeMachineRates } from "@/lib/machine-cost";
import { exclFromIncl, offerMargin } from "@/lib/offer-cost";
import {
  OFFER_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  formatRequestNumber,
  requestTitle,
} from "@/lib/requests";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import OfferEditor from "@/components/OfferEditor";
import {
  emptyCosting,
  type EditorInitial,
  type EditorMachine,
  type EditorMaterial,
} from "@/lib/offer-editor";
import {
  acceptOfferAction,
  createOfferAction,
  declineOfferAction,
  deleteOfferAction,
  markOfferSentAction,
} from "@/lib/request-actions";

// One offer. A draft opens in the editor (lines + costing + texts); once sent
// it's read-only and you record the customer's answer: accept (→ order),
// decline, or make a new version with changes.

/** Brussels-local yyyy-mm-dd for a date input. */
function dateInput(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(d);
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const offer = await prisma.offer.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: { sortOrder: "asc" },
        include: { materials: { include: { material: true } }, machine: true },
      },
      request: { include: { customer: true, order: { select: { id: true, orderNumber: true } } } },
      order: { select: { id: true, orderNumber: true } },
    },
  });
  if (!offer) notFound();

  const request = offer.request;
  const reqNo = formatRequestNumber(request.requestNumber);
  const requestClosed = request.status === "ACCEPTED" || !!request.order;
  const isDraft = offer.status === "DRAFT";
  const pdfHref = `/offers/${offer.id}/pdf`;

  // ---- Editor data (drafts only) ---------------------------------------------
  let editor: React.ReactNode = null;
  if (isDraft) {
    const usedMachineIds = offer.lines.map((l) => l.machineId).filter((v): v is string => !!v);
    const usedMaterialIds = offer.lines.flatMap((l) => l.materials.map((m) => m.materialId));
    const [machines, materials] = await Promise.all([
      prisma.machine.findMany({
        where: { OR: [{ active: true }, { id: { in: usedMachineIds } }] },
        orderBy: { name: "asc" },
      }),
      prisma.material.findMany({
        where: { OR: [{ active: true }, { id: { in: usedMaterialIds } }] },
        orderBy: { name: "asc" },
        select: { id: true, name: true, unit: true, unitCost: true, active: true },
      }),
    ]);
    const editorMachines: EditorMachine[] = machines.map((m) => ({
      id: m.id,
      name: m.name,
      costPerMinute: Number(computeMachineRates(m).costPerMinute),
      active: m.active,
    }));
    const editorMaterials: EditorMaterial[] = materials.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      unitCost: Number(m.unitCost),
      active: m.active,
    }));

    // Businesses get net prices by default; you can switch in the editor.
    const pricesIncludeVat = !request.customer.isBusiness;
    let key = 0;
    const initial: EditorInitial = {
      pricesIncludeVat,
      validUntil: dateInput(offer.validUntil),
      intro: offer.intro ?? "",
      terms: offer.terms ?? "",
      lines: offer.lines.map((l) => {
        const incl = Number(l.unitPrice);
        const vat = Number(l.vatRate);
        const price = pricesIncludeVat ? incl : exclFromIncl(incl, vat);
        const hasCosting =
          !!l.machineId || l.materials.length > 0 || !!l.labourHours || !!l.setupHours;
        return {
          key: ++key,
          description: l.description,
          quantity: String(l.quantity),
          price: incl === 0 ? "" : price.toFixed(2).replace(".", ","),
          vatRate: String(Number(l.vatRate)),
          costingOpen: hasCosting,
          costing: hasCosting
            ? {
                machineId: l.machineId ?? "",
                machineMinutes: l.machineMinutes ? String(Number(l.machineMinutes)).replace(".", ",") : "",
                labourHours: l.labourHours ? String(Number(l.labourHours)).replace(".", ",") : "",
                setupHours: l.setupHours ? String(Number(l.setupHours)).replace(".", ",") : "",
                materials: l.materials.length
                  ? l.materials.map((m) => ({
                      key: ++key,
                      materialId: m.materialId,
                      quantity: String(Number(m.quantity)).replace(".", ","),
                    }))
                  : emptyCosting().materials,
              }
            : emptyCosting(),
        };
      }),
    };

    editor = (
      <OfferEditor
        offerId={offer.id}
        initial={initial}
        machines={editorMachines}
        materials={editorMaterials}
        hourlyRate={pricing.hourlyRate}
        markupPercent={pricing.markupPercent}
      >
        <section className="panel">
          <h2>Versturen</h2>
          <ol className="steps small">
            <li>Sla de offerte op.</li>
            <li>
              <a href={`${pdfHref}?download=1`} className="link-strong">
                Download de PDF
              </a>{" "}
              en stuur hem naar de klant.
            </li>
            <li>Markeer hieronder als verstuurd.</li>
          </ol>
          <ActionForm action={markOfferSentAction} className="stack-form">
            <input type="hidden" name="offerId" value={offer.id} />
            <SubmitButton pendingLabel="Bezig…">Markeer als verstuurd</SubmitButton>
          </ActionForm>
        </section>

        <AcceptPanel offerId={offer.id} draft />

        <section className="panel">
          <ActionForm
            action={deleteOfferAction}
            className="stack-form"
            confirm={`Concept ${offer.offerNumber} verwijderen?`}
          >
            <input type="hidden" name="offerId" value={offer.id} />
            <SubmitButton className="btn-link-danger" pendingLabel="Verwijderen…">
              Concept verwijderen
            </SubmitButton>
          </ActionForm>
        </section>
      </OfferEditor>
    );
  }

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href={`/requests/${request.id}`} className="muted small">
            ← Aanvraag {reqNo} · {requestTitle(request)}
          </Link>
          <h1>
            Offerte {offer.offerNumber}{" "}
            <span className={`status-pill status-pill--offer-${offer.status.toLowerCase()}`}>
              {OFFER_STATUS_LABELS[offer.status]}
            </span>
          </h1>
          <p className="muted">
            {request.customer.companyName ? `${request.customer.companyName} · ` : ""}
            {request.customer.name}
            {offer.version > 1 ? ` · versie ${offer.version}` : ""} · aangemaakt{" "}
            {formatDate(offer.createdAt)}
            {offer.sentAt ? ` · verstuurd ${formatDate(offer.sentAt)}` : ""}
            {offer.validUntil ? ` · geldig tot ${formatDate(offer.validUntil)}` : ""}
          </p>
        </div>
        <div className="header-actions">
          <a href={pdfHref} target="_blank" rel="noreferrer" className="btn-ghost btn-ghost--dark">
            PDF bekijken
          </a>
          <a href={`${pdfHref}?download=1`} className="btn-primary">
            PDF downloaden
          </a>
        </div>
      </header>

      {isDraft ? (
        editor
      ) : (
        <div className="detail-grid">
          <div className="detail-main">
            <section className="panel">
              <h2>Lijnen</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Omschrijving</th>
                      <th>Aantal</th>
                      <th>Prijs/stuk (incl.)</th>
                      <th>Totaal</th>
                      <th>Kostprijs/stuk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offer.lines.map((l) => {
                      const net = exclFromIncl(Number(l.unitPrice), Number(l.vatRate));
                      const m = l.unitCost ? offerMargin(net, Number(l.unitCost)) : null;
                      const costing = [
                        l.machine && l.machineMinutes && `${l.machine.name} ${Number(l.machineMinutes)} min`,
                        ...l.materials.map(
                          (x) => `${Number(x.quantity)} ${x.material.unit} ${x.material.name}`,
                        ),
                        l.labourHours && `${Number(l.labourHours)} u/stuk`,
                        l.setupHours && `${Number(l.setupHours)} u opstart`,
                      ].filter(Boolean);
                      return (
                        <tr key={l.id}>
                          <td>
                            <span className="prewrap">{l.description}</span>
                            {costing.length > 0 && (
                              <div className="muted small">{costing.join(" · ")}</div>
                            )}
                          </td>
                          <td>{l.quantity}</td>
                          <td>
                            {formatEUR(l.unitPrice.toString())}
                            <div className="muted small">{formatEUR(net)} excl. {Number(l.vatRate)}%</div>
                          </td>
                          <td>{formatEUR(l.lineTotal.toString())}</td>
                          <td className="small">
                            {l.unitCost ? (
                              <>
                                {formatEUR(l.unitCost.toString())}
                                {m && (
                                  <div className={`small ${m.margin < 0 ? "stock-low" : "muted"}`}>
                                    marge {formatEUR(m.margin)}
                                    {m.percent != null ? ` (${m.percent}%)` : ""}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="totals-box">
                <div className="totals-line">
                  <span>Subtotaal (excl. btw)</span>
                  <span>{formatEUR(offer.subtotal.toString())}</span>
                </div>
                <div className="totals-line">
                  <span>Btw</span>
                  <span>{formatEUR(offer.vatAmount.toString())}</span>
                </div>
                <div className="totals-line totals-line--strong">
                  <span>Totaal (incl. btw)</span>
                  <span>{formatEUR(offer.total.toString())}</span>
                </div>
                {offer.costTotal && (
                  <div className="totals-line">
                    <span>Kostprijs (berekende lijnen)</span>
                    <span>{formatEUR(offer.costTotal.toString())}</span>
                  </div>
                )}
              </div>
            </section>

            {(offer.intro || offer.terms) && (
              <section className="panel">
                <h2>Tekst op de offerte</h2>
                {offer.intro && <p className="prewrap small">{offer.intro}</p>}
                {offer.terms && (
                  <>
                    <h3>Voorwaarden</h3>
                    <p className="prewrap small muted">{offer.terms}</p>
                  </>
                )}
              </section>
            )}
          </div>

          <div className="detail-side">
            {offer.status === "ACCEPTED" && offer.order && (
              <section className="panel">
                <h2>Aanvaard</h2>
                <p className="small">
                  Aanvaard op {formatDateTime(offer.decidedAt)} en omgezet in{" "}
                  <Link href={`/orders/${offer.order.id}`} className="link-strong">
                    bestelling #{offer.order.orderNumber}
                  </Link>
                  .
                </p>
              </section>
            )}

            {offer.status === "SENT" && !requestClosed && (
              <>
                <AcceptPanel offerId={offer.id} />
                <section className="panel">
                  <h2>Klant weigert</h2>
                  <ActionForm action={declineOfferAction} className="stack-form">
                    <input type="hidden" name="offerId" value={offer.id} />
                    <input name="note" placeholder="Reden (optioneel)" />
                    <label className="check-field">
                      <input type="checkbox" name="closeRequest" defaultChecked />
                      Aanvraag afsluiten als afgewezen
                    </label>
                    <SubmitButton className="btn-ghost btn-ghost--dark" pendingLabel="Bezig…">
                      Markeer als geweigerd
                    </SubmitButton>
                    <p className="muted small">
                      Vink uit als je nog een betere offerte wilt maken.
                    </p>
                  </ActionForm>
                </section>
              </>
            )}

            {!requestClosed && offer.status !== "ACCEPTED" && (
              <section className="panel">
                <h2>Aanpassen</h2>
                <p className="muted small">
                  Een verstuurde offerte pas je niet meer aan. Maak een nieuwe versie: een kopie
                  als concept
                  {offer.status === "SENT" ? ", en deze offerte wordt als vervangen gemarkeerd" : ""}.
                </p>
                <ActionForm action={createOfferAction} className="stack-form">
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="copyFromOfferId" value={offer.id} />
                  <SubmitButton className="btn-ghost btn-ghost--dark" pendingLabel="Aanmaken…">
                    Nieuwe versie
                  </SubmitButton>
                </ActionForm>
              </section>
            )}

            <section className="panel">
              <h2>Aanvraag</h2>
              <p className="stack small">
                <Link href={`/requests/${request.id}`} className="link-strong">
                  {reqNo} · {requestTitle(request)}
                </Link>
                <span className="muted">Status: {REQUEST_STATUS_LABELS[request.status]}</span>
                {request.order && (
                  <Link href={`/orders/${request.order.id}`} className="link-strong">
                    Bestelling #{request.order.orderNumber} →
                  </Link>
                )}
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Klant aanvaardt": turns the offer into an order (confirmed, draft invoice). */
function AcceptPanel({ offerId, draft = false }: { offerId: string; draft?: boolean }) {
  return (
    <section className="panel">
      <h2>Klant aanvaardt</h2>
      <ActionForm
        action={acceptOfferAction}
        className="stack-form"
        confirm="De klant heeft deze offerte aanvaard? Er wordt een bevestigde bestelling met conceptfactuur aangemaakt."
      >
        <input type="hidden" name="offerId" value={offerId} />
        <input name="note" placeholder="Notitie, bv. 'akkoord per mail 12/10' (optioneel)" />
        <SubmitButton pendingLabel="Bestelling aanmaken…">
          Aanvaard → maak bestelling
        </SubmitButton>
        <p className="muted small">
          {draft
            ? "Al mondeling akkoord, zonder de offerte te versturen? Sla eerst op; dan kan het ook meteen."
            : "Maakt een bevestigde bestelling met de lijnen van deze offerte en een conceptfactuur. Daarna werk je verder zoals bij elke bestelling."}
        </p>
      </ActionForm>
    </section>
  );
}
