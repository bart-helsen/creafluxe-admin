import Link from "next/link";
import { isR2Configured } from "@/lib/r2";
import PurchaseUpload from "@/components/PurchaseUpload";

// "Factuur toevoegen": built for the phone — snap the paper invoice or pick the
// PDF from the mail app the moment it arrives, review it later.

export default function NewPurchaseInvoicePage() {
  const storageReady = isR2Configured();
  return (
    <div className="page">
      <header className="page-header">
        <Link href="/purchases" className="muted small">
          ← Inkoopfacturen
        </Link>
        <h1>Inkoopfactuur toevoegen</h1>
        <p className="muted">
          Elk bestand wordt een aparte factuur in <em>Te controleren</em>. Een PDF met tekst wordt
          lokaal gelezen om de velden voor te stellen — je controleert alles zelf.
        </p>
      </header>

      <section className="panel">
        {!storageReady && (
          <p className="form-error">
            Bestandsopslag (R2) is niet ingesteld, dus bestanden bewaren kan nog niet. Je kan wel een
            factuur zonder bestand invoeren.
          </p>
        )}
        <PurchaseUpload storageReady={storageReady} />
      </section>
    </div>
  );
}
