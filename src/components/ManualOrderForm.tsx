"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import {
  createManualOrderAction,
  type ManualOrderFormState,
} from "@/lib/order-actions";
import { MANUAL_ORDER_CHANNELS, type ManualOrderChannel } from "@/lib/manual-order";

// The "Nieuwe bestelling" form. A client component because the order lines are
// dynamic (add / remove, product → price auto-fill) and the customer is picked
// from a live search. On submit the whole state is sent as one JSON field to
// createManualOrderAction, which validates it server-side.

type OptionType = "MATERIAL" | "SIZE" | "STYLE" | "DESIGN";

export interface PickerProduct {
  id: string;
  sku: string;
  name: string;
  basePrice: string; // "12.00", incl. VAT
  vatRate: string; // "21"
  options: { type: OptionType; value: string; priceDelta: string }[];
}

export interface PickerCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  isBusiness: boolean;
  vatNumber: string | null;
  addressStreet: string | null;
  addressPostal: string | null;
  addressCity: string | null;
  addressCountry: string | null;
}

const OPTION_LABELS: Record<OptionType, string> = {
  MATERIAL: "Materiaal",
  SIZE: "Maat",
  STYLE: "Stijl",
  DESIGN: "Ontwerp",
};
const OPTION_KEYS: Record<OptionType, "material" | "size" | "style" | "design"> = {
  MATERIAL: "material",
  SIZE: "size",
  STYLE: "style",
  DESIGN: "design",
};
const OPTION_TYPES: OptionType[] = ["MATERIAL", "SIZE", "STYLE", "DESIGN"];

const START_STATUSES = [
  { value: "NEW", label: "Nieuw" },
  { value: "QUOTE_SENT", label: "Offerte verstuurd" },
  { value: "CONFIRMED", label: "Bevestigd" },
] as const;

interface Line {
  key: number;
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

const emptyLine = (key: number): Line => ({
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
function toCents(value: string): number {
  const v = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return NaN;
  return Math.round(Number(v) * 100);
}

const eur = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
const formatCents = (cents: number) => eur.format(cents / 100);

/** Catalogue price for a product with the chosen options (base + deltas). */
function catalogueCents(product: PickerProduct, line: Line): number {
  let cents = toCents(product.basePrice);
  for (const type of OPTION_TYPES) {
    const chosen = line[OPTION_KEYS[type]];
    if (!chosen) continue;
    const opt = product.options.find((o) => o.type === type && o.value === chosen);
    if (opt) cents += toCents(opt.priceDelta);
  }
  return cents;
}

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export default function ManualOrderForm({
  products,
  customers,
  initialCustomerId,
}: {
  products: PickerProduct[];
  customers: PickerCustomer[];
  initialCustomerId?: string;
}) {
  const [state, formAction, isPending] = useActionState<
    ManualOrderFormState | undefined,
    FormData
  >(createManualOrderAction, undefined);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // ---- Customer --------------------------------------------------------
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    initialCustomerId || customers.length > 0 ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [query, setQuery] = useState("");
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    email: "",
    phone: "",
    isBusiness: false,
    companyName: "",
    vatNumber: "",
    addressStreet: "",
    addressPostal: "",
    addressCity: "",
    addressCountry: "België",
  });
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) =>
        [c.name, c.email, c.companyName, c.phone, c.vatNumber]
          .filter(Boolean)
          .some((f) => f!.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [customers, query]);

  // Warn when a "new" customer's e-mail is already known.
  const emailTaken =
    customerMode === "new" && newCustomer.email.trim()
      ? customers.find(
          (c) => c.email.toLowerCase() === newCustomer.email.trim().toLowerCase(),
        )
      : undefined;

  const setNew = (patch: Partial<typeof newCustomer>) =>
    setNewCustomer((c) => ({ ...c, ...patch }));

  // ---- Order meta ------------------------------------------------------
  const [type, setType] = useState<"WEBSHOP" | "CUSTOM">("WEBSHOP");
  const [channel, setChannel] = useState<ManualOrderChannel>("telefoon");
  const [initialStatus, setInitialStatus] = useState<string>("NEW");
  const [customerRemarks, setCustomerRemarks] = useState("");
  const [designBrief, setDesignBrief] = useState("");
  const [internalNote, setInternalNote] = useState("");

  // ---- Lines -----------------------------------------------------------
  const [nextKey, setNextKey] = useState(2);
  const [lines, setLines] = useState<Line[]>([emptyLine(1)]);

  const addLine = () => {
    setLines((ls) => [...ls, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  };
  const removeLine = (key: number) =>
    setLines((ls) => ls.filter((l) => l.key !== key));
  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function onProductChange(key: number, productId: string) {
    const product = productById.get(productId);
    if (!product) {
      // Back to a free line: keep what was typed, drop the catalogue options.
      updateLine(key, { productId: "", material: "", size: "", style: "", design: "" });
      return;
    }
    updateLine(key, {
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

  const lineCents = lines.map((l) => {
    const price = toCents(l.unitPrice);
    const qty = Number(l.quantity);
    return Number.isFinite(price) && Number.isInteger(qty) && qty > 0 ? price * qty : NaN;
  });
  const totalCents = lineCents.reduce((s, c) => s + (Number.isNaN(c) ? 0 : c), 0);

  // ---- Delivery --------------------------------------------------------
  const [delivery, setDelivery] = useState({
    requested: false,
    street: "",
    postal: "",
    city: "",
    country: "België",
    notes: "",
  });
  const setDel = (patch: Partial<typeof delivery>) =>
    setDelivery((d) => ({ ...d, ...patch }));

  const addressSource =
    customerMode === "existing"
      ? selectedCustomer && {
          street: selectedCustomer.addressStreet ?? "",
          postal: selectedCustomer.addressPostal ?? "",
          city: selectedCustomer.addressCity ?? "",
          country: selectedCustomer.addressCountry ?? "België",
        }
      : {
          street: newCustomer.addressStreet,
          postal: newCustomer.addressPostal,
          city: newCustomer.addressCity,
          country: newCustomer.addressCountry,
        };
  const hasAddress = !!addressSource && !!(addressSource.street || addressSource.city);

  function toggleDelivery(requested: boolean) {
    // Pre-fill with the customer's address the first time delivery is chosen.
    if (requested && !delivery.street && !delivery.city && hasAddress && addressSource) {
      setDel({ requested, ...addressSource });
    } else {
      setDel({ requested });
    }
  }

  // ---- Payload ---------------------------------------------------------
  // Blank lines (no product, no name, no price) are ignored so an unused
  // empty row doesn't block saving.
  const usedLines = lines.filter(
    (l) => l.productId || l.name.trim() || l.unitPrice.trim(),
  );
  const payload = JSON.stringify({
    customer:
      customerMode === "existing"
        ? { mode: "existing", id: customerId }
        : { mode: "new", ...newCustomer },
    type,
    channel,
    initialStatus,
    items: usedLines.map((l) => ({
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
    })),
    delivery,
    customerRemarks,
    designBrief,
    internalNote,
  });

  return (
    <form
      action={formAction}
      className="detail-grid manual-order"
      onKeyDown={(e) => {
        // Enter in a text field must not save a half-filled order.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="payload" value={payload} />

      <div className="detail-main">
        {/* ---------------- Customer ---------------- */}
        <section className="panel">
          <h2>Klant</h2>
          <div className="segmented">
            <button
              type="button"
              className={`tab ${customerMode === "existing" ? "tab--active" : ""}`}
              onClick={() => setCustomerMode("existing")}
            >
              Bestaande klant
            </button>
            <button
              type="button"
              className={`tab ${customerMode === "new" ? "tab--active" : ""}`}
              onClick={() => setCustomerMode("new")}
            >
              + Nieuwe klant
            </button>
          </div>

          {customerMode === "existing" ? (
            selectedCustomer ? (
              <div className="picked-customer">
                <div className="stack">
                  <strong>{selectedCustomer.name}</strong>
                  {selectedCustomer.companyName && (
                    <span className="small">{selectedCustomer.companyName}</span>
                  )}
                  <span className="muted small">
                    {[selectedCustomer.email, selectedCustomer.phone]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {(selectedCustomer.addressStreet || selectedCustomer.addressCity) && (
                    <span className="muted small">
                      {[
                        selectedCustomer.addressStreet,
                        [selectedCustomer.addressPostal, selectedCustomer.addressCity]
                          .filter(Boolean)
                          .join(" "),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-ghost--dark btn-inline"
                  onClick={() => {
                    setCustomerId("");
                    setQuery("");
                  }}
                >
                  Andere klant
                </button>
              </div>
            ) : (
              <div className="customer-search">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Zoek op naam, e-mail, telefoon of bedrijf"
                  autoFocus
                />
                {query.trim() && (
                  <ul className="customer-results">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setCustomerId(c.id)}>
                          <strong>{c.name}</strong>
                          {c.companyName && <span> · {c.companyName}</span>}
                          <span className="muted small">
                            {" "}
                            {[c.email, c.phone].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                    {matches.length === 0 && (
                      <li className="muted small customer-results-empty">
                        Geen klant gevonden.{" "}
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => {
                            setCustomerMode("new");
                            setNew(
                              query.includes("@")
                                ? { email: query.trim() }
                                : { name: query.trim() },
                            );
                          }}
                        >
                          Nieuwe klant aanmaken
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )
          ) : (
            <div className="form-grid">
              <label className="field">
                Naam *
                <input
                  value={newCustomer.name}
                  onChange={(e) => setNew({ name: e.target.value })}
                  placeholder="Voor- en achternaam"
                />
              </label>
              <label className="field">
                Telefoon
                <input
                  value={newCustomer.phone}
                  onChange={(e) => setNew({ phone: e.target.value })}
                  inputMode="tel"
                />
              </label>
              <label className="field form-col-2">
                E-mail
                <input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNew({ email: e.target.value })}
                  placeholder="Optioneel als je een telefoonnummer hebt"
                />
                {emailTaken && (
                  <span className="hint">
                    Dit e-mailadres hoort al bij <strong>{emailTaken.name}</strong> — de
                    bestelling wordt aan die klant gekoppeld.{" "}
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => {
                        setCustomerMode("existing");
                        setCustomerId(emailTaken.id);
                      }}
                    >
                      Die klant kiezen
                    </button>
                  </span>
                )}
              </label>
              <label className="check-field form-col-2">
                <input
                  type="checkbox"
                  checked={newCustomer.isBusiness}
                  onChange={(e) => setNew({ isBusiness: e.target.checked })}
                />
                Onderneming (factuur op bedrijfsnaam)
              </label>
              {newCustomer.isBusiness && (
                <>
                  <label className="field">
                    Bedrijfsnaam
                    <input
                      value={newCustomer.companyName}
                      onChange={(e) => setNew({ companyName: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Btw-nummer
                    <input
                      value={newCustomer.vatNumber}
                      onChange={(e) => setNew({ vatNumber: e.target.value })}
                      placeholder="BE0123456789"
                    />
                  </label>
                </>
              )}
              <label className="field form-col-2">
                Straat + nr
                <input
                  value={newCustomer.addressStreet}
                  onChange={(e) => setNew({ addressStreet: e.target.value })}
                  placeholder="Optioneel"
                />
              </label>
              <label className="field">
                Postcode
                <input
                  value={newCustomer.addressPostal}
                  onChange={(e) => setNew({ addressPostal: e.target.value })}
                />
              </label>
              <label className="field">
                Gemeente
                <input
                  value={newCustomer.addressCity}
                  onChange={(e) => setNew({ addressCity: e.target.value })}
                />
              </label>
            </div>
          )}
        </section>

        {/* ---------------- Items ---------------- */}
        <section className="panel">
          <h2>Artikelen</h2>
          <p className="muted small">
            Kies een product uit de catalogus (prijs wordt ingevuld, incl. btw)
            of laat het leeg voor een vrije lijn. Prijzen kun je altijd
            aanpassen — een negatieve lijn werkt als korting.
          </p>

          {lines.map((line, idx) => {
            const product = productById.get(line.productId);
            const optionTypes = product
              ? OPTION_TYPES.filter((t) => product.options.some((o) => o.type === t))
              : [];
            const cents = lineCents[idx];
            return (
              <div key={line.key} className="item-block order-line">
                <div className="order-line-grid">
                  <label className="field order-line-product">
                    Product
                    <select
                      value={line.productId}
                      onChange={(e) => onProductChange(line.key, e.target.value)}
                    >
                      <option value="">— Vrije lijn (maatwerk, dienst, korting…) —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {formatCents(toCents(p.basePrice))} · {p.sku}
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
                      {["21", "12", "6", "0"].map((r) => (
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

                <div className="order-line-grid order-line-grid--details">
                  <label className="field order-line-name">
                    Omschrijving {product ? "(op factuur)" : "*"}
                    <input
                      value={line.name}
                      onChange={(e) => updateLine(line.key, { name: e.target.value })}
                      placeholder={product ? product.name : "bv. Naambord 40 cm, eik"}
                    />
                  </label>
                  {optionTypes.map((t) => (
                    <label key={t} className="field">
                      {OPTION_LABELS[t]}
                      <select
                        value={line[OPTION_KEYS[t]]}
                        onChange={(e) => onOptionChange(line, t, e.target.value)}
                      >
                        <option value="">—</option>
                        {product!.options
                          .filter((o) => o.type === t)
                          .map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.value}
                              {toCents(o.priceDelta) !== 0
                                ? ` (${toCents(o.priceDelta) > 0 ? "+" : ""}${formatCents(toCents(o.priceDelta))})`
                                : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                  <label className="field order-line-remarks">
                    Personalisatie / opmerking
                    <input
                      value={line.remarks}
                      onChange={(e) => updateLine(line.key, { remarks: e.target.value })}
                      placeholder="bv. tekst om te graveren"
                    />
                  </label>
                </div>

                {lines.length > 1 && (
                  <button
                    type="button"
                    className="btn-link-danger order-line-remove"
                    onClick={() => removeLine(line.key)}
                  >
                    Verwijderen
                  </button>
                )}
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
        </section>

        {/* ---------------- Details ---------------- */}
        <section className="panel">
          <h2>Levering &amp; details</h2>
          <div className="segmented">
            <button
              type="button"
              className={`tab ${!delivery.requested ? "tab--active" : ""}`}
              onClick={() => toggleDelivery(false)}
            >
              Afhaling
            </button>
            <button
              type="button"
              className={`tab ${delivery.requested ? "tab--active" : ""}`}
              onClick={() => toggleDelivery(true)}
            >
              Levering
            </button>
          </div>

          <div className="form-grid">
            {delivery.requested && (
              <>
                <label className="field form-col-2">
                  Straat + nr *
                  <input
                    value={delivery.street}
                    onChange={(e) => setDel({ street: e.target.value })}
                  />
                </label>
                <label className="field">
                  Postcode
                  <input
                    value={delivery.postal}
                    onChange={(e) => setDel({ postal: e.target.value })}
                  />
                </label>
                <label className="field">
                  Gemeente *
                  <input
                    value={delivery.city}
                    onChange={(e) => setDel({ city: e.target.value })}
                  />
                </label>
                <label className="field">
                  Land
                  <input
                    value={delivery.country}
                    onChange={(e) => setDel({ country: e.target.value })}
                  />
                </label>
                <label className="field">
                  Leveringsnotitie
                  <input
                    value={delivery.notes}
                    onChange={(e) => setDel({ notes: e.target.value })}
                    placeholder="Optioneel"
                  />
                </label>
                {hasAddress && addressSource && (
                  <div className="form-col-2">
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => setDel(addressSource)}
                    >
                      Adres van de klant overnemen
                    </button>
                  </div>
                )}
              </>
            )}

            <label className="field form-col-2">
              Vraag / opmerkingen van de klant
              <textarea
                rows={3}
                value={customerRemarks}
                onChange={(e) => setCustomerRemarks(e.target.value)}
                placeholder="Wat de klant vroeg, deadline, …"
              />
            </label>
            {type === "CUSTOM" && (
              <label className="field form-col-2">
                Ontwerpbriefing
                <textarea
                  rows={4}
                  value={designBrief}
                  onChange={(e) => setDesignBrief(e.target.value)}
                  placeholder="Beschrijving van het maatwerk / idee"
                />
              </label>
            )}
            <label className="field form-col-2">
              Interne notitie
              <input
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="Komt in de statusgeschiedenis (optioneel)"
              />
            </label>
          </div>
        </section>
      </div>

      {/* ---------------- Summary ---------------- */}
      <div className="detail-side">
        <section className="panel manual-order-summary">
          <h2>Bestelling</h2>
          <div className="form-grid form-grid--single">
            <label className="field">
              Binnengekomen via
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as ManualOrderChannel)}
              >
                {(Object.keys(MANUAL_ORDER_CHANNELS) as ManualOrderChannel[]).map((c) => (
                  <option key={c} value={c}>
                    {MANUAL_ORDER_CHANNELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Soort
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "WEBSHOP" | "CUSTOM")}
              >
                <option value="WEBSHOP">Catalogusproducten</option>
                <option value="CUSTOM">Maatwerk (atelier)</option>
              </select>
            </label>
            <label className="field">
              Startstatus
              <select
                value={initialStatus}
                onChange={(e) => setInitialStatus(e.target.value)}
              >
                {START_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="totals-box totals-box--full">
            <div className="totals-line">
              <span>
                {usedLines.length} {usedLines.length === 1 ? "lijn" : "lijnen"}
              </span>
            </div>
            <div className="totals-line totals-line--strong">
              <span>Totaal (incl. btw)</span>
              <span>{formatCents(totalCents)}</span>
            </div>
          </div>

          {state?.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={isPending}>
              {isPending ? "Opslaan…" : "Bestelling aanmaken"}
            </button>
            <Link href="/orders" className="btn-ghost btn-ghost--dark btn-inline">
              Annuleren
            </Link>
          </div>
          <p className="muted small">
            Er wordt meteen een conceptfactuur gemaakt. Er gaat geen e-mail naar
            de klant.
          </p>
        </section>
      </div>
    </form>
  );
}
