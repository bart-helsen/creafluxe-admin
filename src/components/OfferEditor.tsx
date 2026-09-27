"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { saveOfferAction } from "@/lib/request-actions";
import type { ActionState } from "@/components/ActionForm";
import {
  computeOfferLineCost,
  exclFromIncl,
  inclFromExcl,
  offerMargin,
  round2,
  type OfferCostResult,
} from "@/lib/offer-cost";
import {
  emptyCosting,
  type EditorCosting,
  type EditorInitial,
  type EditorLine,
  type EditorMachine,
  type EditorMaterial,
} from "@/lib/offer-editor";

export type { EditorInitial, EditorMachine, EditorMaterial };

// The offer editor (draft offers). Each line has a description, quantity and
// your price; open "Kostprijs berekenen" on a line to add material use, machine
// time and hours — the same building blocks as the Kostprijs calculator — and
// see the cost and a suggested price live. You always choose the final price.
//
// Prices can be typed excl. or incl. VAT (toggle at the top); they're stored
// incl. VAT like orders and invoices. The server recomputes everything on save.

const eur = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
const fmt = (n: number) => eur.format(Number.isFinite(n) ? n : 0);
const num = (v: string) => {
  const t = v.trim().replace(",", ".");
  if (t === "") return 0;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};
const toInput = (n: number) => round2(n).toFixed(2).replace(".", ",");

let keySeq = 1000;
const nextKey = () => ++keySeq;

export default function OfferEditor({
  offerId,
  initial,
  machines,
  materials,
  hourlyRate,
  markupPercent,
  children,
}: {
  offerId: string;
  initial: EditorInitial;
  machines: EditorMachine[];
  materials: EditorMaterial[];
  hourlyRate: number;
  markupPercent: number;
  /** Extra panels for the side column (send / accept / delete). */
  children?: React.ReactNode;
}) {
  const [state, formAction, isPending] = useActionState<ActionState | undefined, FormData>(
    async (prev, fd) => {
      const res = await saveOfferAction(prev, fd);
      if (res.success) setDirty(false);
      return res;
    },
    undefined,
  );

  const [pricesIncludeVat, setPricesIncludeVat] = useState(initial.pricesIncludeVat);
  const [validUntil, setValidUntil] = useState(initial.validUntil);
  const [intro, setIntro] = useState(initial.intro);
  const [terms, setTerms] = useState(initial.terms);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines);
  const [dirty, setDirty] = useState(false);

  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const touch = () => setDirty(true);
  const updateLine = (key: number, patch: Partial<EditorLine>) => {
    touch();
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const updateCosting = (key: number, patch: Partial<EditorCosting>) => {
    touch();
    setLines((ls) =>
      ls.map((l) => (l.key === key ? { ...l, costing: { ...l.costing, ...patch } } : l)),
    );
  };

  /** Switch the entry mode, converting every typed price so it means the same. */
  function switchMode(incl: boolean) {
    if (incl === pricesIncludeVat) return;
    setLines((ls) =>
      ls.map((l) => {
        const p = num(l.price);
        if (!Number.isFinite(p) || l.price.trim() === "") return l;
        const vat = num(l.vatRate) || 0;
        return { ...l, price: toInput(incl ? inclFromExcl(p, vat) : exclFromIncl(p, vat)) };
      }),
    );
    setPricesIncludeVat(incl);
    touch();
  }

  // ---- Per-line figures -------------------------------------------------------
  function lineCost(l: EditorLine): OfferCostResult | null {
    const c = l.costing;
    const mats = c.materials
      .filter((m) => m.materialId && num(m.quantity) > 0)
      .map((m) => ({
        unitCost: materialById.get(m.materialId)?.unitCost ?? 0,
        quantity: num(m.quantity),
      }));
    const machine = c.machineId ? machineById.get(c.machineId) : undefined;
    const minutes = num(c.machineMinutes);
    const has =
      (machine && minutes > 0) || mats.length > 0 || num(c.labourHours) > 0 || num(c.setupHours) > 0;
    if (!has) return null;
    return computeOfferLineCost({
      quantity: Math.max(1, Math.floor(num(l.quantity)) || 1),
      machineCostPerMinute: machine?.costPerMinute ?? 0,
      machineMinutes: machine ? minutes : 0,
      materials: mats,
      labourHours: num(c.labourHours),
      setupHours: num(c.setupHours),
      hourlyRate,
      markupPercent,
      vatRate: num(l.vatRate) || 0,
    });
  }

  const figures = lines.map((l) => {
    const qty = Math.floor(num(l.quantity));
    const vat = num(l.vatRate);
    const price = num(l.price);
    const valid = Number.isFinite(price) && qty > 0 && Number.isFinite(vat);
    const unitIncl = valid ? (pricesIncludeVat ? price : inclFromExcl(price, vat)) : 0;
    const unitExcl = valid ? (pricesIncludeVat ? exclFromIncl(price, vat) : price) : 0;
    const cost = l.costingOpen ? lineCost(l) : null;
    return {
      valid,
      qty: valid ? qty : 0,
      vat: valid ? vat : 0,
      unitIncl,
      unitExcl,
      lineIncl: round2(unitIncl * (valid ? qty : 0)),
      cost,
      margin: cost && valid ? offerMargin(unitExcl, cost.unitCost) : null,
    };
  });

  // Totals the same way as the invoice: gross per VAT rate, net derived once.
  const byRate = new Map<number, number>();
  for (const f of figures) byRate.set(f.vat, (byRate.get(f.vat) ?? 0) + f.lineIncl);
  const total = round2([...byRate.values()].reduce((s, v) => s + v, 0));
  const subtotal = round2(
    [...byRate.entries()].reduce((s, [rate, gross]) => s + round2(gross / (1 + rate / 100)), 0),
  );
  const costed = figures.filter((f) => f.cost);
  const costTotal = round2(costed.reduce((s, f) => s + (f.cost?.lineCost ?? 0), 0));
  const costedNet = round2(costed.reduce((s, f) => s + f.unitExcl * f.qty, 0));
  const invalidLine = figures.some((f, i) => !f.valid && lines[i].description.trim() !== "");

  // ---- Payload ------------------------------------------------------------------
  const payload = JSON.stringify({
    pricesIncludeVat,
    validUntil,
    intro,
    terms,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      price: l.price.trim() === "" ? "0" : l.price,
      vatRate: l.vatRate,
      costing: l.costingOpen
        ? {
            machineId: l.costing.machineId || null,
            machineMinutes: l.costing.machineMinutes,
            labourHours: l.costing.labourHours,
            setupHours: l.costing.setupHours,
            materials: l.costing.materials
              .filter((m) => m.materialId)
              .map((m) => ({ materialId: m.materialId, quantity: m.quantity })),
          }
        : null,
    })),
  });

  const modeLabel = pricesIncludeVat ? "incl. btw" : "excl. btw";

  return (
    <div className="detail-grid">
      <form
        id="offer-editor"
        // Submitted by hand (not via the `action` prop) so React doesn't reset
        // the form after saving — that would visually reset the controlled
        // <select>s (machine, material, VAT) even though the state is kept.
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
        className="detail-main"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
        }}
      >
        <input type="hidden" name="offerId" value={offerId} />
        <input type="hidden" name="payload" value={payload} />

        <section className="panel">
          <div className="edit-head">
            <h2>Lijnen</h2>
            <div className="segmented segmented--compact">
              <button
                type="button"
                className={`tab ${!pricesIncludeVat ? "tab--active" : ""}`}
                onClick={() => switchMode(false)}
              >
                Prijzen excl. btw
              </button>
              <button
                type="button"
                className={`tab ${pricesIncludeVat ? "tab--active" : ""}`}
                onClick={() => switchMode(true)}
              >
                incl. btw
              </button>
            </div>
          </div>

          {lines.map((l, i) => {
            const f = figures[i];
            const machine = l.costing.machineId ? machineById.get(l.costing.machineId) : undefined;
            const suggested = f.cost
              ? pricesIncludeVat
                ? { exact: f.cost.suggestedIncl, rounded: f.cost.roundedIncl }
                : { exact: f.cost.suggestedExcl, rounded: f.cost.roundedExcl }
              : null;
            return (
              <div key={l.key} className="order-line offer-line">
                <div className="offer-line-grid">
                  <label className="field offer-line-desc">
                    Omschrijving
                    <textarea
                      rows={2}
                      value={l.description}
                      onChange={(e) => updateLine(l.key, { description: e.target.value })}
                      placeholder="Wat maak je, in welk materiaal, welke afmetingen…"
                    />
                  </label>
                  <label className="field">
                    Aantal
                    <input
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Prijs/stuk ({modeLabel})
                    <input
                      inputMode="decimal"
                      value={l.price}
                      onChange={(e) => updateLine(l.key, { price: e.target.value })}
                      placeholder="0,00"
                      className={Number.isNaN(num(l.price)) ? "input-invalid" : undefined}
                    />
                  </label>
                  <label className="field">
                    Btw %
                    <select
                      value={l.vatRate}
                      onChange={(e) => updateLine(l.key, { vatRate: e.target.value })}
                    >
                      {["21", "12", "6", "0"].map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="order-line-total">
                    <span className="muted small">Totaal incl.</span>
                    <strong>{fmt(f.lineIncl)}</strong>
                  </div>
                </div>

                <div className="offer-line-tools">
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => updateLine(l.key, { costingOpen: !l.costingOpen })}
                  >
                    {l.costingOpen ? "▾ Kostprijsberekening" : "▸ Kostprijs berekenen"}
                  </button>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn-link-danger"
                      onClick={() => {
                        touch();
                        setLines((ls) => ls.filter((x) => x.key !== l.key));
                      }}
                    >
                      Lijn verwijderen
                    </button>
                  )}
                </div>

                {l.costingOpen && (
                  <div className="costing">
                    <div className="costing-inputs">
                      <h4>Machine (per stuk)</h4>
                      <div className="calc-row">
                        <select
                          value={l.costing.machineId}
                          onChange={(e) => updateCosting(l.key, { machineId: e.target.value })}
                        >
                          <option value="">— geen machine —</option>
                          {machines
                            .filter((m) => m.active || m.id === l.costing.machineId)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                        <input
                          inputMode="decimal"
                          placeholder="minuten"
                          value={l.costing.machineMinutes}
                          onChange={(e) => updateCosting(l.key, { machineMinutes: e.target.value })}
                        />
                      </div>

                      <h4>Materiaal (per stuk)</h4>
                      {l.costing.materials.map((m) => {
                        const mat = materialById.get(m.materialId);
                        return (
                          <div key={m.key} className="calc-row calc-row--removable">
                            <select
                              value={m.materialId}
                              onChange={(e) =>
                                updateCosting(l.key, {
                                  materials: l.costing.materials.map((x) =>
                                    x.key === m.key ? { ...x, materialId: e.target.value } : x,
                                  ),
                                })
                              }
                            >
                              <option value="">— materiaal —</option>
                              {materials
                                .filter((x) => x.active || x.id === m.materialId)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name} ({x.unit})
                                  </option>
                                ))}
                            </select>
                            <input
                              inputMode="decimal"
                              placeholder={mat ? mat.unit : "aantal"}
                              value={m.quantity}
                              onChange={(e) =>
                                updateCosting(l.key, {
                                  materials: l.costing.materials.map((x) =>
                                    x.key === m.key ? { ...x, quantity: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            {l.costing.materials.length > 1 && (
                              <button
                                type="button"
                                className="btn-link-danger"
                                aria-label="Materiaal verwijderen"
                                onClick={() =>
                                  updateCosting(l.key, {
                                    materials: l.costing.materials.filter((x) => x.key !== m.key),
                                  })
                                }
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() =>
                          updateCosting(l.key, {
                            materials: [
                              ...l.costing.materials,
                              { key: nextKey(), materialId: "", quantity: "" },
                            ],
                          })
                        }
                      >
                        + materiaal
                      </button>

                      <h4>Arbeid</h4>
                      <div className="costing-hours">
                        <label className="field">
                          Uren nabewerking per stuk
                          <input
                            inputMode="decimal"
                            placeholder="bv. 0,25"
                            value={l.costing.labourHours}
                            onChange={(e) => updateCosting(l.key, { labourHours: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          Eenmalige uren (ontwerp, opstart)
                          <input
                            inputMode="decimal"
                            placeholder="bv. 1,5"
                            value={l.costing.setupHours}
                            onChange={(e) => updateCosting(l.key, { setupHours: e.target.value })}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="costing-result">
                      {!f.cost ? (
                        <p className="muted small">
                          Vul machinetijd, materiaal en/of uren in om de kostprijs te zien.
                        </p>
                      ) : (
                        <>
                          <div className="totals-line">
                            <span>
                              Machine
                              {machine ? ` (${num(l.costing.machineMinutes)} min)` : ""}
                            </span>
                            <span>{fmt(f.cost.machineCost)}</span>
                          </div>
                          <div className="totals-line">
                            <span>Materiaal</span>
                            <span>{fmt(f.cost.materialCost)}</span>
                          </div>
                          <div className="totals-line">
                            <span>Arbeid ({fmt(hourlyRate)}/u)</span>
                            <span>{fmt(f.cost.labourCost)}</span>
                          </div>
                          {f.cost.setupCost > 0 && (
                            <div className="totals-line">
                              <span>Opstart {fmt(f.cost.setupCost)} ÷ {f.qty || 1}</span>
                              <span>{fmt(f.cost.setupCost / (f.qty || 1))}</span>
                            </div>
                          )}
                          <div className="totals-line totals-line--strong">
                            <span>Kostprijs/stuk (excl.)</span>
                            <span>{fmt(f.cost.unitCost)}</span>
                          </div>
                          <div className="totals-line">
                            <span>
                              Richtprijs +{markupPercent}% ({modeLabel})
                            </span>
                            <span>{fmt(suggested!.exact)}</span>
                          </div>
                          <div className="costing-use">
                            <button
                              type="button"
                              className="btn-ghost btn-ghost--dark btn-inline"
                              onClick={() => updateLine(l.key, { price: toInput(suggested!.exact) })}
                            >
                              Gebruik {fmt(suggested!.exact)}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-ghost--dark btn-inline"
                              onClick={() =>
                                updateLine(l.key, { price: toInput(suggested!.rounded) })
                              }
                            >
                              Afgerond {fmt(suggested!.rounded)}
                            </button>
                          </div>
                          {f.margin && f.unitExcl !== 0 && (
                            <div className="totals-line">
                              <span>Marge op jouw prijs</span>
                              <span className={f.margin.margin < 0 ? "stock-low" : undefined}>
                                {fmt(f.margin.margin)}/stuk
                                {f.margin.percent != null ? ` (${f.margin.percent}%)` : ""}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="btn-ghost btn-ghost--dark btn-inline"
            onClick={() => {
              touch();
              setLines((ls) => [
                ...ls,
                {
                  key: nextKey(),
                  description: "",
                  quantity: "1",
                  price: "",
                  vatRate: "21",
                  costingOpen: false,
                  costing: emptyCosting(),
                },
              ]);
            }}
          >
            + Lijn toevoegen
          </button>
          <p className="muted small">
            Leveringskost of korting? Voeg een aparte lijn toe (een negatieve prijs werkt als
            korting). De kostprijs gebruikt de huidige materiaal- en machinekosten en je uurloon
            van {fmt(hourlyRate)}.
            {!pricesIncludeVat &&
              " Prijzen worden net als bij bestellingen incl. btw bewaard (per stuk op de cent afgerond); de offerte-PDF toont de prijzen incl. btw met het subtotaal excl. btw eronder."}
          </p>
        </section>

        <section className="panel">
          <h2>Tekst op de offerte</h2>
          <div className="form-grid">
            <label className="field">
              Geldig tot
              <input
                type="date"
                value={validUntil}
                onChange={(e) => {
                  touch();
                  setValidUntil(e.target.value);
                }}
              />
            </label>
            <div />
            <label className="field form-col-2">
              Inleiding
              <textarea
                rows={4}
                value={intro}
                onChange={(e) => {
                  touch();
                  setIntro(e.target.value);
                }}
              />
            </label>
            <label className="field form-col-2">
              Voorwaarden
              <textarea
                rows={4}
                value={terms}
                onChange={(e) => {
                  touch();
                  setTerms(e.target.value);
                }}
              />
            </label>
          </div>
        </section>
      </form>

      <div className="detail-side">
        <section className="panel manual-order-summary">
          <h2>Totaal</h2>
          <div className="totals-box totals-box--full">
            <div className="totals-line">
              <span>Subtotaal (excl. btw)</span>
              <span>{fmt(subtotal)}</span>
            </div>
            <div className="totals-line">
              <span>Btw</span>
              <span>{fmt(round2(total - subtotal))}</span>
            </div>
            <div className="totals-line totals-line--strong">
              <span>Totaal (incl. btw)</span>
              <span>{fmt(total)}</span>
            </div>
            {costed.length > 0 && (
              <>
                <div className="totals-line">
                  <span>Kostprijs{costed.length < lines.length ? " (berekende lijnen)" : ""}</span>
                  <span>{fmt(costTotal)}</span>
                </div>
                <div className="totals-line">
                  <span>Marge (excl. btw)</span>
                  <span className={costedNet - costTotal < 0 ? "stock-low" : undefined}>
                    {fmt(round2(costedNet - costTotal))}
                  </span>
                </div>
              </>
            )}
          </div>

          {invalidLine && (
            <p className="form-error">Controleer de aantallen en prijzen (bv. 12,50).</p>
          )}
          {state?.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}
          {state?.success && !dirty && (
            <p className="form-success" role="status">
              {state.success}
            </p>
          )}
          {dirty && <p className="hint">Niet-opgeslagen wijzigingen.</p>}

          <div className="form-actions">
            <button type="submit" form="offer-editor" className="btn-primary" disabled={isPending}>
              {isPending ? "Opslaan…" : "Offerte opslaan"}
            </button>
            <a
              href={`/offers/${offerId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost btn-ghost--dark btn-inline"
              aria-disabled={dirty}
              onClick={(e) => {
                if (dirty && !window.confirm("Je hebt niet-opgeslagen wijzigingen. De PDF toont de laatst opgeslagen versie. Toch openen?")) {
                  e.preventDefault();
                }
              }}
            >
              PDF bekijken
            </a>
          </div>
        </section>

        {children}
      </div>
    </div>
  );
}
