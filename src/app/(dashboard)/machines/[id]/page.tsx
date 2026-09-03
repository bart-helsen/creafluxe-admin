import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { computeMachineRates, formatPerMinute } from "@/lib/machine-cost";
import { updateMachineAction } from "@/lib/machine-actions";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) notFound();

  const rates = computeMachineRates(machine);

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/machines" className="muted small">
            ← Machines
          </Link>
          <h1>{machine.name}</h1>
          <p className="muted">
            <span className="status-pill">
              {machine.active ? "Actief" : "Inactief"}
            </span>{" "}
            · {formatEUR(rates.costPerHour)}/uur ·{" "}
            {formatPerMinute(rates.costPerMinute)}/min
          </p>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2>Machinegegevens</h2>
            <form action={updateMachineAction} className="form-grid">
              <input type="hidden" name="id" value={machine.id} />
              <label className="field form-col-2">
                Naam *
                <input name="name" defaultValue={machine.name} required />
              </label>
              <label className="field form-col-2">
                Omschrijving
                <input
                  name="description"
                  defaultValue={machine.description ?? ""}
                />
              </label>

              <label className="field">
                Aankoopprijs (excl. btw)
                <input
                  name="purchasePrice"
                  inputMode="decimal"
                  defaultValue={machine.purchasePrice.toString()}
                />
              </label>
              <label className="field">
                Verwachte levensduur (draaiuren)
                <input
                  name="lifetimeHours"
                  inputMode="decimal"
                  defaultValue={Number(machine.lifetimeHours).toString()}
                />
              </label>

              <label className="field">
                Vermogen (kW)
                <input
                  name="powerKw"
                  inputMode="decimal"
                  defaultValue={Number(machine.powerKw).toString()}
                />
              </label>
              <label className="field">
                Onderhoud per jaar (excl. btw)
                <input
                  name="maintenancePerYear"
                  inputMode="decimal"
                  defaultValue={machine.maintenancePerYear.toString()}
                />
              </label>

              <label className="field">
                Gebruik per jaar (uren)
                <input
                  name="usageHoursPerYear"
                  inputMode="decimal"
                  defaultValue={Number(machine.usageHoursPerYear).toString()}
                />
              </label>
              <div className="field" aria-hidden="true" />

              <label className="field form-col-2">
                Notities
                <input name="notes" defaultValue={machine.notes ?? ""} />
              </label>

              <label className="check-field form-col-2">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={machine.active}
                />
                Actief
              </label>

              <div className="form-actions form-col-2">
                <button type="submit" className="btn-primary">
                  Opslaan
                </button>
              </div>
            </form>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel">
            <h2>Gebruikskost</h2>
            <p className="small muted">
              Automatisch berekend uit de gegevens hiernaast. Sla op om bij te
              werken.
            </p>
            <div className="totals-box" style={{ marginLeft: 0, maxWidth: "none" }}>
              <div className="totals-line">
                <span>Afschrijving / uur</span>
                <span>{formatEUR(rates.depreciationPerHour)}</span>
              </div>
              <div className="totals-line">
                <span>
                  Energie / uur ({Number(machine.powerKw)} kW ×{" "}
                  {formatEUR(rates.electricityPrice)}/kWh)
                </span>
                <span>{formatEUR(rates.energyPerHour)}</span>
              </div>
              <div className="totals-line">
                <span>Onderhoud / uur</span>
                <span>{formatEUR(rates.maintenancePerHour)}</span>
              </div>
              <div className="totals-line totals-line--strong">
                <span>Kost / uur</span>
                <span>{formatEUR(rates.costPerHour)}</span>
              </div>
              <div className="totals-line">
                <span>Kost / minuut</span>
                <span>{formatPerMinute(rates.costPerMinute)}</span>
              </div>
            </div>
            <p className="muted small">Alle bedragen excl. btw.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
