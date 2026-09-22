"use client";

import { useMemo } from "react";

// Shared order-line editor, used by "Nieuwe bestelling" (/orders/new) and by
// "Bestelling bewerken" on the order page. Pure UI: the parent owns the lines
// state; this component renders the rows and reports changes.

export type OptionType = "MATERIAL" | "SIZE" | "STYLE" | "DESIGN";

export interface PickerProduct {
  id: string;
  sku: string;
  name: string;
  basePrice: string; // "12.00", incl. VAT
  vatRate: string; // "21"
  active: boolean;
  options: { type: OptionType; value: string; priceDelta: string }[];
}

export interface Line {
  key: number;
  id?: string; // existing OrderItem id (edit mode)
  fileCount?: number; // design files attached to this existing line
  productId: string; // "" = free line
  name: string;
  unitPrice: string;
  quantity: string;
  vatRate: string;
  material: string;
  size: string;
  style: string;
  design: string;
  remarks: string;
}

export const OPTION_LABELS: Record<OptionType, string> = {
  MATERIAL: "Materiaal",
  SIZE: "Maat",
  STYLE: "Stijl",
  DESIGN: "Ontwerp",
};
export const OPTION_KEYS: Record<OptionType, "material" | "size" | "style" | "design"> = {
  MATERIAL: "material",
  SIZE: "size",
  STYLE: "style",
  DESIGN: "design",
};
export const OPTION_TYPES: OptionType[] = ["MATERIAL", "SIZE", "STYLE", "DESIGN"];

export const emptyLine = (key: number): Line => ({
  key,
  productId: "",
  name: "",
  unitPrice: "",
  quantity: "1",
  vatRate: "21",
  material: "",
  size: "",
  style: "",
  design: "",
  remarks: "",
});

/** "12,50" / "12.5" → 1250 cents; NaN when not a valid amount. */
export function toCents(value: string): number {
  const v = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return NaN;
  return Math.round(Number(v) * 100);
}

const eur = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
export const formatCents = (cents: number) => eur.format(cents / 100);
export const centsToInput = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",");

/** Catalogue price for a product with the line's chosen options (base + deltas). */
export function catalogueCents(product: PickerProduct, line: Line): number {
  let cents = toCents(product.basePrice);
  for (const type of OPTION_TYPES) {
    const chosen = line[OPTION_KEYS[type]];
    if (!chosen) continue;
    const opt = product.options.find((o) => o.type === type && o.value === chosen);
    if (opt) cents += toCents(opt.priceDelta);
  }
  return cents;
}

/** Line total in cents (NaN while the price or quantity is invalid). */
export function lineCents(l: Line): number {
  const price = toCents(l.unitPrice);
  const qty = Number(l.quantity);
  return Number.isFinite(price) && Number.isInteger(qty) && qty > 0 ? price * qty : NaN;
}

/** Lines that actually hold something (an untouched empty row is ignored). */
export const usedLines = (lines: Line[]) =>
  lines.filter((l) => l.id || l.productId || l.name.trim() || l.unitPrice.trim());

/** Payload shape expected by the server-side Zod schema. */
export const linesToPayload = (lines: Line[]) =>
  usedLines(lines).map((l) => ({
    id: l.id ?? null,
    productId: l.productId || null,
    name: l.name,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    vatRate: l.vatRate,
    material: l.material,
    size: l.size,
    style: l.style,
    design: l.design,
    remarks: l.remarks,
  }));

/**
 * Re-price every catalogue line from the current catalogue (base price +
 * option deltas, and the product's VAT rate). Free lines and discounts are
 * left untouched. Returns the new lines and how many prices changed.
 */
export function refreshFromCatalogue(
  lines: Line[],
  productById: Map<string, PickerProduct>,
): { lines: Line[]; changed: number } {
  let changed = 0;
  const next = lines.map((l) => {
    const product = productById.get(l.productId);
    if (!product) return l;
    const cents = catalogueCents(product, l);
    if (cents !== toCents(l.unitPrice) || product.vatRate !== l.vatRate) changed++;
    return { ...l, unitPrice: centsToInput(cents), vatRate: product.vatRate };
  });
  return { lines: next, changed };
}

export default function OrderLinesEditor({
  products,
  lines,
  onChange,
}: {
  products: PickerProduct[];
  lines: Line[];
  onChange: (lines: Line[]) => void;
}) {
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  // Inactive products only appear in the list when a line already uses them.
  const selectable = products.filter(
    (p) => p.active || lines.some((l) => l.productId === p.id),
  );

  const updateLine = (key: number, patch: Partial<Line>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) => onChange(lines.filter((l) => l.key !== key));
  const addLine = () =>
    onChange([...lines, emptyLine(Math.max(0, ...lines.map((l) => l.key)) + 1)]);

  function onProductChange(line: Line, productId: string) {
    const product = productById.get(productId);
    if (!product) {
      // Back to a free line: keep what was typed, drop the catalogue options.
      updateLine(line.key, { productId: "", material: "", size: "", style: "", design: "" });
      return;
    }
    updateLine(line.key, {
      productId,
      name: product.name,
      unitPrice: centsToInput(toCents(product.basePrice)),
      vatRate: product.vatRate,
      material: "",
      size: "",
      style: "",
      design: "",
    });
  }

  function onOptionChange(line: Line, type: OptionType, value: string) {
    const product = productById.get(line.productId);
    const next = { ...line, [OPTION_KEYS[type]]: value };
    // Re-price from the catalogue when an option changes (you can still
    // overwrite the price afterwards).
    const patch: Partial<Line> = { [OPTION_KEYS[type]]: value };
    if (product) patch.unitPrice = centsToInput(catalogueCents(product, next));
    updateLine(line.key, patch);
  }

  return (
    <>
      {lines.map((line) => {
        const product = productById.get(line.productId);
        // Show option selects for the product's option types, plus any value
        // already stored on the line that is no longer offered.
        const optionTypes = OPTION_TYPES.filter(
          (t) =>
            (product && product.options.some((o) => o.type === t)) ||
            !!line[OPTION_KEYS[t]],
        );
        const cents = lineCents(line);
        const catalogue = product ? catalogueCents(product, line) : NaN;
        const priceDiffers =
          !!product && !Number.isNaN(catalogue) && catalogue !== toCents(line.unitPrice);
        return (
          <div key={line.key} className="item-block order-line">
            <div className="order-line-grid">
              <label className="field order-line-product">
                Product
                <select
                  value={line.productId}
                  onChange={(e) => onProductChange(line, e.target.value)}
                >
                  <option value="">— Vrije lijn (maatwerk, dienst, korting…) —</option>
                  {selectable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatCents(toCents(p.basePrice))} · {p.sku}
                      {p.active ? "" : " (inactief)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field order-line-qty">
                Aantal
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                />
              </label>
              <label className="field order-line-price">
                Stukprijs
                <input
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  placeholder="0,00"
                />
              </label>
              <label className="field order-line-vat">
                Btw
                <select
                  value={line.vatRate}
                  disabled={!!product}
                  title={product ? "Btw-tarief van het product" : undefined}
                  onChange={(e) => updateLine(line.key, { vatRate: e.target.value })}
                >
                  {Array.from(new Set(["21", "12", "6", "0", line.vatRate])).map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </label>
              <div className="order-line-total">
                <span className="muted small">Totaal</span>
                <strong>{Number.isNaN(cents) ? "—" : formatCents(cents)}</strong>
              </div>
            </div>

            {priceDiffers && (
              <p className="hint order-line-hint">
                Catalogusprijs is nu {formatCents(catalogue)}.{" "}
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => updateLine(line.key, { unitPrice: centsToInput(catalogue) })}
                >
                  Overnemen
                </button>
              </p>
            )}

            <div className="order-line-grid order-line-grid--details">
              <label className="field order-line-name">
                Omschrijving {product ? "(op factuur)" : "*"}
                <input
                  value={line.name}
                  onChange={(e) => updateLine(line.key, { name: e.target.value })}
                  placeholder={product ? product.name : "bv. Naambord 40 cm, eik"}
                />
              </label>
              {optionTypes.map((t) => {
                const current = line[OPTION_KEYS[t]];
                const offered = product?.options.filter((o) => o.type === t) ?? [];
                const stale = current && !offered.some((o) => o.value === current);
                return (
                  <label key={t} className="field">
                    {OPTION_LABELS[t]}
                    <select
                      value={current}
                      onChange={(e) => onOptionChange(line, t, e.target.value)}
                    >
                      <option value="">—</option>
                      {stale && <option value={current}>{current} (niet meer in catalogus)</option>}
                      {offered.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.value}
                          {toCents(o.priceDelta) !== 0
                            ? ` (${toCents(o.priceDelta) > 0 ? "+" : ""}${formatCents(toCents(o.priceDelta))})`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <label className="field order-line-remarks">
                Personalisatie / opmerking
                <input
                  value={line.remarks}
                  onChange={(e) => updateLine(line.key, { remarks: e.target.value })}
                  placeholder="bv. tekst om te graveren"
                />
              </label>
            </div>

            {lines.length > 1 &&
              (line.fileCount ? (
                <span className="muted small order-line-remove">
                  Heeft {line.fileCount} ontwerpbestand{line.fileCount === 1 ? "" : "en"} —
                  kan niet verwijderd worden.
                </span>
              ) : (
                <button
                  type="button"
                  className="btn-link-danger order-line-remove"
                  onClick={() => removeLine(line.key)}
                >
                  Verwijderen
                </button>
              ))}
          </div>
        );
      })}

      <button
        type="button"
        className="btn-ghost btn-ghost--dark btn-inline"
        onClick={addLine}
      >
        + Lijn toevoegen
      </button>
    </>
  );
}
