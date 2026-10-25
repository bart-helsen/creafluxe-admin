"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { SubmitButton, type ActionState } from "@/components/ActionForm";
import { savePurchaseInvoiceAction } from "@/lib/purchase-actions";
import {
  checkPurchaseInvoice,
  countryFromVatNumber,
  findDuplicates,
  type DuplicateCandidate,
} from "@/lib/purchase-checks";
import {
  CURRENCIES,
  EU_COUNTRIES,
  OTHER_COUNTRIES,
  PURCHASE_CATEGORIES,
  PURCHASE_CATEGORY_LABELS,
  VAT_TREATMENTS,
  VAT_TREATMENT_LABELS,
  centsToAmount,
  toCents,
  type PurchaseCategoryValue,
  type PurchaseStatusValue,
  type PurchaseVatTreatmentValue,
} from "@/lib/purchases";

// The review screen's form. Built for speed with a keyboard:
//   - pick a known supplier and its remembered country, VAT number, currency,
//     category and VAT treatment fill in (only fields you haven't touched);
//   - values read from the PDF are pre-filled and marked "uit PDF";
//   - gross fills itself from net + VAT until you type your own;
//   - checks run live while you type (they warn, never block);
//   - Ctrl/⌘+Enter = Bevestigen, Ctrl/⌘+S = Opslaan.
// Nothing counts as checked until you press Bevestigen.

export interface ReviewSupplier {
  id: string;
  name: string;
  countryCode: string | null;
  vatNumber: string | null;
  defaultCurrency: string | null;
  defaultCategory: PurchaseCategoryValue | null;
  defaultVatTreatment: PurchaseVatTreatmentValue | null;
}

export interface ReviewValues {
  supplierId: string;
  supplierName: string;
  supplierCountry: string;
  supplierVatNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  amountEur: string;
  vatTreatment: PurchaseVatTreatmentValue;
  category: PurchaseCategoryValue;
  notes: string;
}

type Field = keyof ReviewValues;

/** "1234.56" → "1234,56" for display in an input. */
const show = (v: string) => v.replace(".", ",");

export default function PurchaseReviewForm({
  id,
  status,
  initial,
  suggested,
  suppliers,
  others,
  today,
}: {
  id: string;
  status: PurchaseStatusValue;
  initial: ReviewValues;
  /** Fields whose initial value came from the PDF text (not yet saved by you). */
  suggested: Field[];
  suppliers: ReviewSupplier[];
  others: DuplicateCandidate[];
  today: string;
}) {
  const [state, formAction] = useActionState<ActionState | undefined, FormData>(
    savePurchaseInvoiceAction,
    undefined,
  );
  const [v, setV] = useState<ReviewValues>(initial);
  const [touched, setTouched] = useState<Set<Field>>(new Set());
  const [fromPdf, setFromPdf] = useState<Set<Field>>(new Set(suggested));
  const formRef = useRef<HTMLFormElement>(null);
  const readOnly = status === "UPLOADED_TO_DEXXTER";

  const byName = useMemo(
    () => new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s])),
    [suppliers],
  );

  const set = (field: Field, value: string) => {
    setTouched((t) => new Set(t).add(field));
    setFromPdf((p) => {
      if (!p.has(field)) return p;
      const next = new Set(p);
      next.delete(field);
      return next;
    });
    setV((prev) => {
      const next = { ...prev, [field]: value } as ReviewValues;
      // Gross follows net + VAT until you type your own.
      if ((field === "netAmount" || field === "vatAmount") && !touched.has("grossAmount")) {
        const net = toCents(next.netAmount);
        if (net != null) next.grossAmount = show(centsToAmount(net + (toCents(next.vatAmount) ?? 0)));
      }
      // A typed VAT number tells the country.
      if (field === "supplierVatNumber" && !touched.has("supplierCountry")) {
        const c = countryFromVatNumber(value);
        if (c) next.supplierCountry = c;
      }
      return next;
    });
  };

  const onSupplierName = (name: string) => {
    set("supplierName", name);
    const match = byName.get(name.trim().toLowerCase());
    setV((prev) => {
      const next = { ...prev, supplierName: name, supplierId: match?.id ?? "" };
      if (!match) return next;
      // Remembered defaults fill every field you haven't touched yourself.
      const apply = <K extends Field>(field: K, value: ReviewValues[K] | null) => {
        if (value != null && value !== "" && !touched.has(field)) next[field] = value;
      };
      apply("supplierCountry", match.countryCode);
      apply("supplierVatNumber", match.vatNumber);
      apply("currency", match.defaultCurrency);
      apply("category", match.defaultCategory);
      apply("vatTreatment", match.defaultVatTreatment);
      return next;
    });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const button = (intent: string) =>
        formRef.current?.querySelector<HTMLButtonElement>(`button[name="intent"][value="${intent}"]`) ??
        undefined;
      if (e.key === "Enter") {
        e.preventDefault();
        formRef.current?.requestSubmit(button(status === "RECEIVED" ? "confirm" : "save"));
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit(button("save"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, status]);

  const duplicates = findDuplicates(
    { id, supplierId: v.supplierId || null, supplierName: v.supplierName, invoiceNumber: v.invoiceNumber },
    others,
  );
  const flags = checkPurchaseInvoice(
    { ...v, supplierCountry: v.supplierCountry || null },
    { today, duplicates },
  );

  const mark = (field: Field) =>
    fromPdf.has(field) ? <span className="field-tag">uit PDF</span> : null;

  const firstEmpty = (["supplierName", "invoiceNumber", "invoiceDate", "netAmount"] as Field[]).find(
    (f) => !v[f],
  );

  return (
    <form ref={formRef} action={formAction} className="review-form">
      {/* First submit button in the form = what plain Enter does: save, never confirm. */}
      <button type="submit" name="intent" value="save" hidden tabIndex={-1} aria-hidden />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="supplierId" value={v.supplierId} />

      <fieldset disabled={readOnly} className="review-fields">
        <label className="field review-wide">
          <span>Leverancier * {mark("supplierName")}</span>
          <input
            name="supplierName"
            list="purchase-suppliers"
            value={v.supplierName}
            onChange={(e) => onSupplierName(e.target.value)}
            autoComplete="off"
            autoFocus={firstEmpty === "supplierName"}
            placeholder="Begin te typen…"
          />
          <datalist id="purchase-suppliers">
            {suppliers.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
          <span className="muted small">
            {v.supplierId ? "Bekende leverancier — standaardwaarden ingevuld." : v.supplierName ? "Nieuwe leverancier: wordt aangemaakt bij opslaan." : ""}
          </span>
        </label>

        <label className="field">
          <span>Land {mark("supplierCountry")}</span>
          <select
            name="supplierCountry"
            value={v.supplierCountry}
            onChange={(e) => set("supplierCountry", e.target.value)}
          >
            <option value="">—</option>
            <optgroup label="EU">
              {Object.entries(EU_COUNTRIES).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Buiten EU">
              {Object.entries(OTHER_COUNTRIES).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="field">
          <span>Btw-nummer {mark("supplierVatNumber")}</span>
          <input
            name="supplierVatNumber"
            value={v.supplierVatNumber}
            onChange={(e) => set("supplierVatNumber", e.target.value)}
            placeholder="bv. DE123456789"
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Factuurnummer * {mark("invoiceNumber")}</span>
          <input
            name="invoiceNumber"
            value={v.invoiceNumber}
            onChange={(e) => set("invoiceNumber", e.target.value)}
            autoFocus={firstEmpty === "invoiceNumber"}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Factuurdatum * {mark("invoiceDate")}</span>
          <input
            type="date"
            name="invoiceDate"
            value={v.invoiceDate}
            onChange={(e) => set("invoiceDate", e.target.value)}
            autoFocus={firstEmpty === "invoiceDate"}
          />
        </label>

        <label className="field">
          <span>Munt {mark("currency")}</span>
          <select name="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
            {(CURRENCIES.includes(v.currency) ? CURRENCIES : [v.currency, ...CURRENCIES]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Netto * {mark("netAmount")}</span>
          <input
            name="netAmount"
            inputMode="decimal"
            value={v.netAmount}
            onChange={(e) => set("netAmount", e.target.value)}
            autoFocus={firstEmpty === "netAmount"}
            placeholder="0,00"
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Btw {mark("vatAmount")}</span>
          <input
            name="vatAmount"
            inputMode="decimal"
            value={v.vatAmount}
            onChange={(e) => set("vatAmount", e.target.value)}
            placeholder="leeg = geen btw"
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Bruto (totaal) * {mark("grossAmount")}</span>
          <input
            name="grossAmount"
            inputMode="decimal"
            value={v.grossAmount}
            onChange={(e) => set("grossAmount", e.target.value)}
            placeholder="0,00"
            autoComplete="off"
          />
        </label>

        {v.currency !== "EUR" && (
          <label className="field">
            <span>Bruto in EUR</span>
            <input
              name="amountEur"
              inputMode="decimal"
              value={v.amountEur}
              onChange={(e) => set("amountEur", e.target.value)}
              placeholder="zoals afgeschreven"
              autoComplete="off"
            />
          </label>
        )}

        <label className="field">
          <span>Btw-behandeling</span>
          <select
            name="vatTreatment"
            value={v.vatTreatment}
            onChange={(e) => set("vatTreatment", e.target.value)}
          >
            {VAT_TREATMENTS.map((t) => (
              <option key={t} value={t}>
                {VAT_TREATMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Categorie</span>
          <select name="category" value={v.category} onChange={(e) => set("category", e.target.value)}>
            {PURCHASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PURCHASE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="field review-wide">
          <span>Notities</span>
          <textarea name="notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
      </fieldset>

      {flags.length > 0 && (
        <ul className="check-flags" aria-live="polite">
          {flags.map((f) => (
            <li key={f.code}>⚠ {f.message}</li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="form-actions">
          {status === "RECEIVED" ? (
            <>
              <SubmitButton name="intent" value="confirm" pendingLabel="Bevestigen…">
                Bevestigen — klaar voor Dexxter
              </SubmitButton>
              <button type="submit" name="intent" value="save" className="btn-ghost btn-ghost--dark">
                Opslaan (later verder)
              </button>
            </>
          ) : (
            <>
              <SubmitButton name="intent" value="save" pendingLabel="Opslaan…">
                Wijzigingen opslaan
              </SubmitButton>
            </>
          )}
          <span className="muted small kbd-hint">
            <kbd>Ctrl</kbd>+<kbd>Enter</kbd> {status === "RECEIVED" ? "bevestigen" : "opslaan"} ·{" "}
            <kbd>Ctrl</kbd>+<kbd>S</kbd> opslaan
          </span>
        </div>
      )}

      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="form-success" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
