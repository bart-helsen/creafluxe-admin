"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createManualRequestAction } from "@/lib/request-actions";
import type { ActionState } from "@/components/ActionForm";
import { MANUAL_ORDER_CHANNELS, type ManualOrderChannel } from "@/lib/manual-order";
import CustomerPicker, {
  emptyNewCustomer,
  type NewCustomerDraft,
  type PickerCustomer,
} from "@/components/CustomerPicker";

// "Nieuwe aanvraag": a custom job someone asked you about directly (phone,
// e-mail, in person, social media). Like the Atelier form on the website it
// has no price yet — you'll make an offer from the request page.

export default function NewRequestForm({
  customers,
  initialCustomerId,
}: {
  customers: PickerCustomer[];
  initialCustomerId?: string;
}) {
  const [state, formAction, isPending] = useActionState<ActionState | undefined, FormData>(
    createManualRequestAction,
    undefined,
  );

  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    initialCustomerId || customers.length > 0 ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(emptyNewCustomer);
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const [channel, setChannel] = useState<ManualOrderChannel>("telefoon");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerRemarks, setCustomerRemarks] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [delivery, setDelivery] = useState({
    requested: false,
    street: "",
    postal: "",
    city: "",
    country: "België",
    notes: "",
  });
  const setDel = (patch: Partial<typeof delivery>) => setDelivery((d) => ({ ...d, ...patch }));

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
    if (requested && !delivery.street && !delivery.city && hasAddress && addressSource) {
      setDel({ requested, ...addressSource });
    } else {
      setDel({ requested });
    }
  }

  const payload = JSON.stringify({
    customer:
      customerMode === "existing"
        ? { mode: "existing", id: customerId }
        : { mode: "new", ...newCustomer },
    channel,
    title,
    description,
    customerRemarks,
    delivery,
    internalNote,
  });

  return (
    <form
      action={formAction}
      className="detail-grid manual-order"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="payload" value={payload} />

      <div className="detail-main">
        <section className="panel">
          <h2>Klant</h2>
          <CustomerPicker
            customers={customers}
            mode={customerMode}
            onModeChange={setCustomerMode}
            customerId={customerId}
            onCustomerIdChange={setCustomerId}
            newCustomer={newCustomer}
            onNewCustomerChange={(patch) => setNewCustomer((c) => ({ ...c, ...patch }))}
            subject="aanvraag"
          />
        </section>

        <section className="panel">
          <h2>Wat vraagt de klant?</h2>
          <div className="form-grid">
            <label className="field form-col-2">
              Korte titel
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="bv. Naambord eik 60 cm met logo (optioneel)"
              />
            </label>
            <label className="field form-col-2">
              Omschrijving *
              <textarea
                rows={7}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Wat wil de klant laten maken? Materiaal, afmetingen, aantallen, gravure, deadline, …"
              />
            </label>
            <label className="field form-col-2">
              Extra opmerkingen van de klant
              <textarea
                rows={2}
                value={customerRemarks}
                onChange={(e) => setCustomerRemarks(e.target.value)}
                placeholder="Optioneel"
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>Levering</h2>
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
          {delivery.requested && (
            <div className="form-grid">
              <label className="field form-col-2">
                Straat + nr *
                <input value={delivery.street} onChange={(e) => setDel({ street: e.target.value })} />
              </label>
              <label className="field">
                Postcode
                <input value={delivery.postal} onChange={(e) => setDel({ postal: e.target.value })} />
              </label>
              <label className="field">
                Gemeente *
                <input value={delivery.city} onChange={(e) => setDel({ city: e.target.value })} />
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
                  <button type="button" className="btn-text" onClick={() => setDel(addressSource)}>
                    Adres van de klant overnemen
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="detail-side">
        <section className="panel manual-order-summary">
          <h2>Aanvraag</h2>
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
              Interne notitie
              <input
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="Komt in de tijdlijn (optioneel)"
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
              {isPending ? "Opslaan…" : "Aanvraag aanmaken"}
            </button>
            <Link href="/requests" className="btn-ghost btn-ghost--dark btn-inline">
              Annuleren
            </Link>
          </div>
          <p className="muted small">
            Dit is nog geen bestelling. Op de aanvraag maak je daarna een offerte; pas als de klant
            die aanvaardt, wordt het een bestelling.
          </p>
        </section>
      </div>
    </form>
  );
}
