import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, formatEUR } from "@/lib/money";
import { VAT_TREATMENT_LABELS, purchaseTitle } from "@/lib/purchases";
import { isR2Configured } from "@/lib/r2";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import { markUploadedAction } from "@/lib/purchase-actions";
import { packFileName, uniqueNames } from "@/server/purchases/dexxterPack";
import { isoDate } from "@/server/purchases/purchaseInvoices";

// The Dexxter routine in two clicks: download the pack (files renamed + a
// summary CSV), upload the files in Dexxter, then mark them here in bulk.

export default async function DexxterPackPage() {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { status: "CHECKED" },
    orderBy: [{ invoiceDate: "asc" }, { receivedAt: "asc" }],
  });
  const received = await prisma.purchaseInvoice.count({ where: { status: "RECEIVED" } });

  const names = uniqueNames(
    invoices.map((p) => packFileName({ ...p, invoiceDate: isoDate(p.invoiceDate) })),
  );
  const zipHref = `/purchases/pack/zip?ids=${invoices.map((p) => p.id).join(",")}`;
  const withoutFile = invoices.filter((p) => !p.fileKey).length;

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/purchases" className="muted small">
          ← Inkoopfacturen
        </Link>
        <h1>Dexxter-pakket</h1>
        <p className="muted">
          Alle gecontroleerde facturen die nog niet in Dexxter staan, in één zip — hernoemd als{" "}
          <code>JJJJ-MM-DD_leverancier_factuurnummer.pdf</code>, met een samenvatting (CSV) om na te
          kijken.
        </p>
      </header>

      {received > 0 && (
        <p className="muted small">
          Er {received === 1 ? "is" : "zijn"} nog {received} factu{received === 1 ? "ur" : "ren"}{" "}
          <Link href="/purchases?bucket=RECEIVED" className="link-strong">
            te controleren
          </Link>{" "}
          — die zitten pas in het pakket nadat je ze bevestigd hebt.
        </p>
      )}

      {invoices.length === 0 ? (
        <div className="panel">
          <p className="muted">Niets klaar voor Dexxter. Bevestig eerst facturen in ‘Te controleren’.</p>
        </div>
      ) : (
        <>
          <section className="panel">
            <h2>1. Download het pakket</h2>
            <p>
              <a href={zipHref} className="btn-primary">
                Download pakket (.zip, {invoices.length} factu{invoices.length === 1 ? "ur" : "ren"})
              </a>
            </p>
            {(!isR2Configured() || withoutFile > 0) && (
              <p className="muted small">
                {isR2Configured()
                  ? `${withoutFile} factu${withoutFile === 1 ? "ur heeft" : "ren hebben"} geen bestand en staa${withoutFile === 1 ? "t" : "n"} enkel in de CSV.`
                  : "Bestandsopslag (R2) is niet ingesteld: het pakket bevat enkel de CSV."}
              </p>
            )}
            <h2>2. Upload de bestanden in Dexxter</h2>
            <p className="muted small">
              Sleep de PDF&apos;s uit de zip naar Dexxter en kijk de bedragen na tegen de CSV.
            </p>
          </section>

          <section className="panel">
            <h2>3. Markeer als geüpload</h2>
            <ActionForm
              action={markUploadedAction}
              className="stack-form"
              confirm="De aangevinkte facturen markeren als geüpload naar Dexxter?"
            >
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Bestand in de zip</th>
                      <th>Factuur</th>
                      <th>Datum</th>
                      <th>Bruto</th>
                      <th>Btw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((p, i) => (
                      <tr key={p.id}>
                        <td>
                          <input type="checkbox" name="ids" value={p.id} defaultChecked aria-label="Geüpload" />
                        </td>
                        <td className="small">
                          <code>{p.fileKey ? names[i] : "— (geen bestand)"}</code>
                        </td>
                        <td>
                          <Link href={`/purchases/${p.id}`} className="link-strong">
                            {purchaseTitle(p)}
                          </Link>
                        </td>
                        <td className="nowrap">{formatDate(p.invoiceDate)}</td>
                        <td className="nowrap">
                          {p.grossAmount == null
                            ? "—"
                            : p.currency === "EUR"
                              ? formatEUR(p.grossAmount.toString())
                              : `${p.currency} ${p.grossAmount.toString().replace(".", ",")}`}
                        </td>
                        <td className="small">{VAT_TREATMENT_LABELS[p.vatTreatment]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SubmitButton pendingLabel="Markeren…">Markeer aangevinkte als ‘In Dexxter’</SubmitButton>
            </ActionForm>
          </section>
        </>
      )}
    </div>
  );
}
