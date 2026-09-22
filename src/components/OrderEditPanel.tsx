"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  updateOrderItemsAction,
  type OrderEditFormState,
} from "@/lib/order-actions";
import OrderLinesEditor, {
  catalogueCents,
  formatCents,
  lineCents,
  linesToPayload,
  refreshFromCatalogue,
  toCents,
  usedLines,
  type Line,
  type PickerProduct,
} from "@/components/OrderLinesEditor";

// "Bestelling bewerken" on the order page. Collapsed it shows whether any
// line's price differs from the current catalogue; opened it reuses the same
// line editor as "Nieuwe bestelling". Saving rewrites the order lines, logs the
// change in the timeline and rebuilds the draft invoice. Locked once the
// invoice has been issued.

export default function OrderEditPanel({
  orderId,
  initialLines,
  currentTotal,
  products,
  lockedReason,
}: {
  orderId: string;
  initialLines: Line[];
  currentTotal: string; // "41.50"
  products: PickerProduct[];
  lockedReason: string | null;
}) {
  const [state, formAction, isPending] = useActionState<
    OrderEditFormState | undefined,
    FormData
  >(updateOrderItemsAction, undefined);

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [note, setNote] = useState("");
  const [refreshInfo, setRefreshInfo] = useState<string | null>(null);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // Close the editor after a successful save (the page re-renders with the
  // new lines via revalidatePath).
  useEffect(() => {
    if (state?.success) {
      setEditing(false);
      setNote("");
      setRefreshInfo(null);
    }
  }, [state]);

  // Lines whose stored price differs from what the catalogue says today.
  const outdated = initialLines.filter((l) => {
    const p = productById.get(l.productId);
    return p && catalogueCents(p, l) !== toCents(l.unitPrice);
  }).length;

  function open(withCatalogueRefresh: boolean) {
    if (withCatalogueRefresh) {
      const r = refreshFromCatalogue(initialLines, productById);
      setLines(r.lines);
      setRefreshInfo(
        r.changed === 0
          ? "Alle prijzen komen al overeen met de catalogus."
          : `${r.changed} ${r.changed === 1 ? "prijs" : "prijzen"} bijgewerkt naar de catalogus — controleer en klik op Opslaan.`,
      );
    } else {
      setLines(initialLines);
      setRefreshInfo(null);
    }
    setEditing(true);
  }

  function refreshInEditor() {
    const r = refreshFromCatalogue(lines, productById);
    setLines(r.lines);
    setRefreshInfo(
      r.changed === 0
        ? "Alle prijzen komen al overeen met de catalogus."
        : `${r.changed} ${r.changed === 1 ? "prijs" : "prijzen"} bijgewerkt naar de catalogus — controleer en klik op Opslaan.`,
    );
  }

  const newTotalCents = usedLines(lines).reduce((sum, l) => {
    const c = lineCents(l);
    return sum + (Number.isNaN(c) ? 0 : c);
  }, 0);
  const oldTotalCents = toCents(currentTotal);

  if (lockedReason) {
    return (
      <section className="panel">
        <h2>Bestelling bewerken</h2>
        <p className="muted small">{lockedReason}</p>
      </section>
    );
  }

  if (!editing) {
    return (
      <section className="panel">
        <h2>Bestelling bewerken</h2>
        {state?.success && <p className="form-success">{state.success}</p>}
        <p className="muted small">
          Pas prijzen, aantallen of opties aan, of voeg lijnen toe (bv. korting).
          De conceptfactuur wordt mee aangepast.
        </p>
        {outdated > 0 && (
          <p className="hint">
            {outdated} {outdated === 1 ? "artikel heeft" : "artikelen hebben"} een andere
            prijs dan de huidige catalogus.
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="btn-ghost btn-ghost--dark btn-inline"
            onClick={() => open(false)}
          >
            Bewerken
          </button>
          {outdated > 0 && (
            <button
              type="button"
              className="btn-ghost btn-ghost--dark btn-inline"
              onClick={() => open(true)}
            >
              Prijzen bijwerken naar catalogus
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <form
        action={formAction}
        onKeyDown={(e) => {
          // Enter in a text field must not save half-finished edits.
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input
          type="hidden"
          name="payload"
          value={JSON.stringify({ items: linesToPayload(lines), note })}
        />

        <div className="edit-head">
          <h2>Bestelling bewerken</h2>
          <button
            type="button"
            className="btn-ghost btn-ghost--dark btn-inline"
            onClick={refreshInEditor}
          >
            Prijzen bijwerken naar catalogus
          </button>
        </div>
        {refreshInfo && <p className="hint">{refreshInfo}</p>}

        <OrderLinesEditor products={products} lines={lines} onChange={setLines} />

        <div className="totals-box">
          <div className="totals-line">
            <span>Huidig totaal</span>
            <span>{formatCents(oldTotalCents)}</span>
          </div>
          <div className="totals-line totals-line--strong">
            <span>Nieuw totaal (incl. btw)</span>
            <span>{formatCents(newTotalCents)}</span>
          </div>
        </div>

        <div className="form-grid">
          <label className="field form-col-2">
            Reden (optioneel)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="bv. nieuwe catalogusprijs, klant wil er 2 extra"
            />
          </label>
        </div>

        {state?.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? "Opslaan…" : "Wijzigingen opslaan"}
          </button>
          <button
            type="button"
            className="btn-ghost btn-ghost--dark btn-inline"
            onClick={() => setEditing(false)}
            disabled={isPending}
          >
            Annuleren
          </button>
        </div>
      </form>
    </section>
  );
}
