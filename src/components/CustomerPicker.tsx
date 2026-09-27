"use client";

import { useMemo, useState } from "react";

// Pick an existing customer (live search) or enter a new one. Shared by
// "Nieuwe bestelling" and "Nieuwe aanvraag". Controlled: the parent form owns
// the chosen mode, customer id and new-customer fields (it needs the address
// for delivery and sends everything in its JSON payload).

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

export interface NewCustomerDraft {
  name: string;
  email: string;
  phone: string;
  isBusiness: boolean;
  companyName: string;
  vatNumber: string;
  addressStreet: string;
  addressPostal: string;
  addressCity: string;
  addressCountry: string;
}

export const emptyNewCustomer = (): NewCustomerDraft => ({
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

export default function CustomerPicker({
  customers,
  mode,
  onModeChange,
  customerId,
  onCustomerIdChange,
  newCustomer,
  onNewCustomerChange,
  subject = "bestelling",
}: {
  customers: PickerCustomer[];
  mode: "existing" | "new";
  onModeChange: (mode: "existing" | "new") => void;
  customerId: string;
  onCustomerIdChange: (id: string) => void;
  newCustomer: NewCustomerDraft;
  onNewCustomerChange: (patch: Partial<NewCustomerDraft>) => void;
  /** What gets attached to the customer, for the hint text ("bestelling", "aanvraag"). */
  subject?: string;
}) {
  const [query, setQuery] = useState("");
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
    mode === "new" && newCustomer.email.trim()
      ? customers.find(
          (c) => c.email.toLowerCase() === newCustomer.email.trim().toLowerCase(),
        )
      : undefined;

  return (
    <>
      <div className="segmented">
        <button
          type="button"
          className={`tab ${mode === "existing" ? "tab--active" : ""}`}
          onClick={() => onModeChange("existing")}
        >
          Bestaande klant
        </button>
        <button
          type="button"
          className={`tab ${mode === "new" ? "tab--active" : ""}`}
          onClick={() => onModeChange("new")}
        >
          + Nieuwe klant
        </button>
      </div>

      {mode === "existing" ? (
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
                onCustomerIdChange("");
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
                    <button type="button" onClick={() => onCustomerIdChange(c.id)}>
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
                        onModeChange("new");
                        onNewCustomerChange(
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
              onChange={(e) => onNewCustomerChange({ name: e.target.value })}
              placeholder="Voor- en achternaam"
            />
          </label>
          <label className="field">
            Telefoon
            <input
              value={newCustomer.phone}
              onChange={(e) => onNewCustomerChange({ phone: e.target.value })}
              inputMode="tel"
            />
          </label>
          <label className="field form-col-2">
            E-mail
            <input
              type="email"
              value={newCustomer.email}
              onChange={(e) => onNewCustomerChange({ email: e.target.value })}
              placeholder="Optioneel als je een telefoonnummer hebt"
            />
            {emailTaken && (
              <span className="hint">
                Dit e-mailadres hoort al bij <strong>{emailTaken.name}</strong> — de{" "}
                {subject} wordt aan die klant gekoppeld.{" "}
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    onModeChange("existing");
                    onCustomerIdChange(emailTaken.id);
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
              onChange={(e) => onNewCustomerChange({ isBusiness: e.target.checked })}
            />
            Onderneming (factuur op bedrijfsnaam)
          </label>
          {newCustomer.isBusiness && (
            <>
              <label className="field">
                Bedrijfsnaam
                <input
                  value={newCustomer.companyName}
                  onChange={(e) => onNewCustomerChange({ companyName: e.target.value })}
                />
              </label>
              <label className="field">
                Btw-nummer
                <input
                  value={newCustomer.vatNumber}
                  onChange={(e) => onNewCustomerChange({ vatNumber: e.target.value })}
                  placeholder="BE0123456789"
                />
              </label>
            </>
          )}
          <label className="field form-col-2">
            Straat + nr
            <input
              value={newCustomer.addressStreet}
              onChange={(e) => onNewCustomerChange({ addressStreet: e.target.value })}
              placeholder="Optioneel"
            />
          </label>
          <label className="field">
            Postcode
            <input
              value={newCustomer.addressPostal}
              onChange={(e) => onNewCustomerChange({ addressPostal: e.target.value })}
            />
          </label>
          <label className="field">
            Gemeente
            <input
              value={newCustomer.addressCity}
              onChange={(e) => onNewCustomerChange({ addressCity: e.target.value })}
            />
          </label>
        </div>
      )}
    </>
  );
}
