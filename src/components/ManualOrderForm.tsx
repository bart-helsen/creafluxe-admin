"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import {
  createManualOrderAction,
  type ManualOrderFormState,
} from "@/lib/order-actions";
import { MANUAL_ORDER_CHANNELS, type ManualOrderChannel } from "@/lib/manual-order";
import OrderLinesEditor, {
  emptyLine,
  formatCents,
  lineCents,
  linesToPayload,
  usedLines,
  type Line,
  type PickerProduct,
} from "@/components/OrderLinesEditor";

// The "Nieuwe bestelling" form. A client component because the order lines are
// dynamic (add / remove, product → price auto-fill) and the customer is picked
// from a live search. On submit the whole state is sent as one JSON field to
// createManualOrderAction, which validates it server-side.

export type { PickerProduct };

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

const START_STATUSES = [
  { value: "NEW", label: "Nieuw" },
  { value: "QUOTE_SENT", label: "Offerte verstuurd" },
  { value: "CONFIRMED", label: "Bevestigd" },
] as const;

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
  const [lines, setLines] = useState<Line[]>([emptyLine(1)]);
  const used = usedLines(lines);
  const totalCents = used.reduce((sum, l) => {
    const c = lineCents(l);
    return sum + (Number.isNaN(c) ? 0 : c);
  }, 0);

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
  const payload = JSON.stringify({
    customer:
      customerMode === "existing"
        ? { mode: "existing", id: customerId }
        : { mode: "new", ...newCustomer },
    type,
    channel,
    initialStatus,
    items: linesToPayload(lines),
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

          <OrderLinesEditor products={products} lines={lines} onChange={setLines} />
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
                {used.length} {used.length === 1 ? "lijn" : "lijnen"}
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
