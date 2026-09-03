import Link from "next/link";
import { createMachineAction } from "@/lib/machine-actions";

// Add a machine. The usage cost per minute is derived from these fields — you
// never type it directly. Leave a field at 0 to drop that part of the cost
// (e.g. no maintenance figures yet → €0 maintenance in the total).

export default function NewMachinePage() {
  return (
    <div className="page">
      <header className="page-header">
        <Link href="/machines" className="muted small">
          ← Machines
        </Link>
        <h1>Nieuwe machine</h1>
        <p className="muted">
          Vul in wat de machine kost en hoe je ze gebruikt; de app berekent
          hieruit de kost per uur en per minuut.
        </p>
      </header>

      <section className="panel">
        <form action={createMachineAction} className="form-grid">
          <label className="field form-col-2">
            Naam *
            <input name="name" placeholder="bv. Glowforge Pro" required />
          </label>
          <label className="field form-col-2">
            Omschrijving
            <input name="description" placeholder="Optioneel" />
          </label>

          <label className="field">
            Aankoopprijs (excl. btw)
            <input name="purchasePrice" inputMode="decimal" defaultValue="0.00" />
          </label>
          <label className="field">
            Verwachte levensduur (draaiuren)
            <input
              name="lifetimeHours"
              inputMode="decimal"
              placeholder="bv. 5000"
              defaultValue="0"
            />
          </label>

          <label className="field">
            Vermogen (kW)
            <input
              name="powerKw"
              inputMode="decimal"
              placeholder="bv. 0.8"
              defaultValue="0"
            />
          </label>
          <label className="field">
            Onderhoud per jaar (excl. btw)
            <input
              name="maintenancePerYear"
              inputMode="decimal"
              placeholder="bv. 200"
              defaultValue="0.00"
            />
          </label>

          <label className="field">
            Gebruik per jaar (uren)
            <input
              name="usageHoursPerYear"
              inputMode="decimal"
              placeholder="bv. 400"
              defaultValue="0"
            />
          </label>
          <div className="field" aria-hidden="true" />

          <label className="field form-col-2">
            Notities
            <input name="notes" placeholder="Optioneel" />
          </label>

          <p className="muted small form-col-2">
            De elektriciteitsprijs (€/kWh) staat centraal in de instellingen
            (Railway-variabele <code>PRICING_ELECTRICITY_PRICE</code>) en geldt
            voor alle machines.
          </p>

          <div className="form-actions form-col-2">
            <button type="submit" className="btn-primary">
              Machine aanmaken
            </button>
            <Link href="/machines" className="btn-ghost btn-ghost--dark">
              Annuleren
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
