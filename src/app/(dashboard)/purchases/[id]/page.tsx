import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/money";
import { todayInBrussels } from "@/lib/purchase-checks";
import {
  PURCHASE_SOURCE_LABELS,
  PURCHASE_STATUS_LABELS,
  purchaseTitle,
} from "@/lib/purchases";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import PurchaseReviewForm, { type ReviewValues } from "@/components/PurchaseReviewForm";
import {
  bookPurchaseStockAction,
  changePurchaseStatusAction,
  deletePurchaseInvoiceAction,
  markUploadedAction,
} from "@/lib/purchase-actions";
import { readExtraction } from "@/server/purchases/extract";
import { isoDate } from "@/server/purchases/purchaseInvoices";

// Review one purchase invoice: the file on one side, the fields on the other.
// Confirming moves it to "Klaar voor Dexxter" and jumps to the next one, so a
// batch of invoices is a quick run of Ctrl+Enter.

const EVENT_LABELS = { CREATED: "Ontvangen", UPDATED: "Bijgewerkt", STATUS: "Status gewijzigd" };

const amount = (d: { toString(): string } | null) => (d == null ? "" : d.toString().replace(".", ","));

export default async function PurchaseInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const { id } = await params;
  const { confirmed } = await searchParams;

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "desc" }, include: { user: true } },
      stockMovements: { include: { material: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!invoice) notFound();

  const [suppliers, others, materials, nextToReview, waitingCount] = await Promise.all([
    prisma.supplier.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        countryCode: true,
        vatNumber: true,
        defaultCurrency: true,
        defaultCategory: true,
        defaultVatTreatment: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.purchaseInvoice.findMany({
      where: { invoiceNumber: { not: null }, id: { not: id } },
      select: { id: true, supplierId: true, supplierName: true, invoiceNumber: true },
    }),
    prisma.material.findMany({
      where: { active: true },
      select: { id: true, name: true, sku: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.purchaseInvoice.findFirst({
      where: { status: "RECEIVED", id: { not: id } },
      orderBy: { receivedAt: "asc" },
      select: { id: true },
    }),
    prisma.purchaseInvoice.count({ where: { status: "RECEIVED" } }),
  ]);

  // Initial form values: what you saved, else what the PDF suggested, else the
  // recognised supplier's remembered defaults. Suggestions are marked "uit PDF".
  const extraction = readExtraction(invoice.extraction);
  const fresh = invoice.status === "RECEIVED" && !invoice.supplierName && !invoice.invoiceNumber;
  const known = fresh && extraction?.supplierId ? suppliers.find((s) => s.id === extraction.supplierId) : undefined;
  const suggested: (keyof ReviewValues)[] = [];
  const pick = (field: keyof ReviewValues, saved: string, fromPdf: string | undefined | null): string => {
    if (saved) return saved;
    if (fresh && fromPdf) {
      suggested.push(field);
      return fromPdf;
    }
    return "";
  };

  const initial: ReviewValues = {
    supplierId: invoice.supplierId ?? known?.id ?? "",
    supplierName: pick("supplierName", invoice.supplierName ?? "", extraction?.supplierName),
    supplierCountry: pick(
      "supplierCountry",
      invoice.supplierCountry ?? "",
      extraction?.supplierCountry ?? known?.countryCode,
    ),
    supplierVatNumber: pick(
      "supplierVatNumber",
      invoice.supplierVatNumber ?? "",
      extraction?.supplierVatNumber ?? known?.vatNumber,
    ),
    invoiceNumber: pick("invoiceNumber", invoice.invoiceNumber ?? "", extraction?.invoiceNumber),
    invoiceDate: pick("invoiceDate", isoDate(invoice.invoiceDate) ?? "", extraction?.invoiceDate),
    currency: fresh ? (extraction?.currency ?? known?.defaultCurrency ?? "EUR") : invoice.currency,
    netAmount: pick("netAmount", amount(invoice.netAmount), extraction?.netAmount?.replace(".", ",")),
    vatAmount: pick("vatAmount", amount(invoice.vatAmount), extraction?.vatAmount?.replace(".", ",")),
    grossAmount: pick("grossAmount", amount(invoice.grossAmount), extraction?.grossAmount?.replace(".", ",")),
    amountEur: amount(invoice.amountEur),
    vatTreatment: fresh ? (known?.defaultVatTreatment ?? invoice.vatTreatment) : invoice.vatTreatment,
    category: fresh ? (known?.defaultCategory ?? invoice.category) : invoice.category,
    notes: invoice.notes ?? "",
  };
  if (fresh && extraction?.currency) suggested.push("currency");

  const title = purchaseTitle(invoice);
  const fileUrl = invoice.fileKey ? `/purchases/${invoice.id}/file` : null;
  const isImage = invoice.mimeType?.startsWith("image/");

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/purchases" className="muted small">
            ← Inkoopfacturen
          </Link>
          <h1>{title}</h1>
          <p className="muted">
            via {PURCHASE_SOURCE_LABELS[invoice.source]} · ontvangen {formatDateTime(invoice.receivedAt)} ·{" "}
            <span className={`status-pill status-pill--purchase-${invoice.status.toLowerCase()}`}>
              {PURCHASE_STATUS_LABELS[invoice.status]}
            </span>
          </p>
        </div>
        <div className="header-actions">
          {nextToReview && (
            <Link href={`/purchases/${nextToReview.id}`} className="btn-ghost btn-ghost--dark">
              Volgende te controleren →
            </Link>
          )}
        </div>
      </header>

      {confirmed && (
        <p className="form-success" role="status">
          Vorige factuur bevestigd ✓ — nog {waitingCount} te controleren.
        </p>
      )}

      <div className="review-grid">
        <section className="panel review-preview">
          {fileUrl ? (
            <>
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl} alt={invoice.fileName ?? "Factuur"} className="review-image" />
              ) : (
                <iframe src={fileUrl} title={invoice.fileName ?? "Factuur"} className="review-frame" />
              )}
              <p className="small">
                <a href={fileUrl} target="_blank" rel="noreferrer" className="link-strong">
                  {invoice.fileName} openen ↗
                </a>
              </p>
            </>
          ) : (
            <p className="muted">Geen bestand bij deze factuur.</p>
          )}
        </section>

        <div className="review-side">
          <section className="panel">
            <h2>Gegevens</h2>
            {invoice.status === "RECEIVED" && (
              <p className="muted small">
                {extraction
                  ? `Uit de PDF gelezen: ${extraction.found.length} velden (zekerheid ${extraction.confidence}%). Controleer alles — gemarkeerde velden zijn voorstellen.`
                  : invoice.fileKey
                    ? "Geen leesbare tekst in dit bestand (bv. een foto of scan) — vul de velden zelf in."
                    : ""}
                {extraction?.reverseCharge ? " De factuur vermeldt btw-verlegging." : ""}
              </p>
            )}
            {invoice.status === "UPLOADED_TO_DEXXTER" && (
              <p className="muted small">
                Deze factuur staat in Dexxter ({formatDate(invoice.uploadedToDexxterAt)}). Zet ze terug om
                iets te wijzigen.
              </p>
            )}
            <PurchaseReviewForm
              id={invoice.id}
              status={invoice.status}
              initial={initial}
              suggested={suggested}
              suppliers={suppliers}
              others={others}
              today={todayInBrussels()}
            />
          </section>

          <section className="panel">
            <h2>Status</h2>
            {invoice.status === "RECEIVED" && (
              <ActionForm
                action={deletePurchaseInvoiceAction}
                className="inline-actions"
                confirm="Deze inkoopfactuur verwijderen? (bv. een dubbele upload)"
              >
                <input type="hidden" name="id" value={invoice.id} />
                <SubmitButton className="btn-link-danger" pendingLabel="…">
                  Verwijderen
                </SubmitButton>
              </ActionForm>
            )}
            {invoice.status === "CHECKED" && (
              <div className="stack-form">
                <ActionForm action={markUploadedAction} className="inline-actions">
                  <input type="hidden" name="ids" value={invoice.id} />
                  <SubmitButton pendingLabel="…">Markeer als geüpload naar Dexxter</SubmitButton>
                </ActionForm>
                <ActionForm action={changePurchaseStatusAction} className="inline-actions">
                  <input type="hidden" name="id" value={invoice.id} />
                  <input type="hidden" name="toStatus" value="RECEIVED" />
                  <SubmitButton className="btn-link" pendingLabel="…">
                    Terug naar ‘Te controleren’
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
            {invoice.status === "UPLOADED_TO_DEXXTER" && (
              <ActionForm
                action={changePurchaseStatusAction}
                className="inline-actions"
                confirm="Terugzetten naar ‘Klaar voor Dexxter’? In Dexxter verandert er niets."
              >
                <input type="hidden" name="id" value={invoice.id} />
                <input type="hidden" name="toStatus" value="CHECKED" />
                <SubmitButton className="btn-link" pendingLabel="…">
                  Terugzetten naar ‘Klaar voor Dexxter’
                </SubmitButton>
              </ActionForm>
            )}

            <ol className="timeline">
              {invoice.events.map((e) => (
                <li key={e.id} className="timeline-item timeline-item--status">
                  <div className="timeline-dot" />
                  <div>
                    <strong>{EVENT_LABELS[e.kind]}</strong>
                    {e.fromStatus && e.toStatus && (
                      <span className="muted small">
                        {" "}
                        · {PURCHASE_STATUS_LABELS[e.fromStatus]} → {PURCHASE_STATUS_LABELS[e.toStatus]}
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

          {(invoice.category === "MATERIALS" || invoice.stockMovements.length > 0) && materials.length > 0 && (
            <section className="panel">
              <h2>Voorraad (optioneel)</h2>
              {invoice.stockMovements.length > 0 ? (
                <ul className="plain-list small">
                  {invoice.stockMovements.map((m) => (
                    <li key={m.id}>
                      +{m.quantity.toString()} {m.material.unit} ·{" "}
                      <Link href={`/materials/${m.materialId}`} className="link-strong">
                        {m.material.name}
                      </Link>
                      {m.unitCost ? ` à ${m.unitCost.toString().replace(".", ",")}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">
                  Materiaal gekocht op deze factuur? Boek het hier in; het wordt aan de factuur gekoppeld.
                </p>
              )}
              <ActionForm action={bookPurchaseStockAction} className="stack-form" resetOnSuccess>
                <input type="hidden" name="id" value={invoice.id} />
                <select name="materialId" defaultValue="" required>
                  <option value="" disabled>
                    Kies materiaal…
                  </option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku})
                    </option>
                  ))}
                </select>
                <div className="calc-row">
                  <input name="quantity" inputMode="decimal" placeholder="Aantal" required />
                  <input name="unitCost" inputMode="decimal" placeholder="Prijs/eenheid excl. btw" />
                </div>
                <SubmitButton className="btn-ghost btn-ghost--dark" pendingLabel="Inboeken…">
                  Inboeken
                </SubmitButton>
              </ActionForm>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
