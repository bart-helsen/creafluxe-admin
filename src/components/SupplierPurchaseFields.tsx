import {
  CURRENCIES,
  EU_COUNTRIES,
  OTHER_COUNTRIES,
  PURCHASE_CATEGORIES,
  PURCHASE_CATEGORY_LABELS,
  VAT_TREATMENTS,
  VAT_TREATMENT_LABELS,
} from "@/lib/purchases";

// The purchase-invoice fields of a supplier: VAT number, country and the
// defaults the Inkoopfacturen review form fills in. Confirming an invoice keeps
// these up to date automatically; edit them here when something changes.

export default function SupplierPurchaseFields({
  supplier,
}: {
  supplier?: {
    vatNumber: string | null;
    countryCode: string | null;
    defaultCurrency: string | null;
    defaultCategory: string | null;
    defaultVatTreatment: string | null;
  };
}) {
  return (
    <>
      <label className="field">
        Btw-nummer
        <input name="vatNumber" defaultValue={supplier?.vatNumber ?? ""} placeholder="bv. DE123456789" />
      </label>
      <label className="field">
        Land (btw)
        <select name="countryCode" defaultValue={supplier?.countryCode ?? ""}>
          <option value="">—</option>
          {Object.entries({ ...EU_COUNTRIES, ...OTHER_COUNTRIES }).map(([code, label]) => (
            <option key={code} value={code}>
              {code} · {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Standaard munt
        <select name="defaultCurrency" defaultValue={supplier?.defaultCurrency ?? ""}>
          <option value="">—</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Standaard categorie
        <select name="defaultCategory" defaultValue={supplier?.defaultCategory ?? ""}>
          <option value="">—</option>
          {PURCHASE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PURCHASE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Standaard btw-behandeling
        <select name="defaultVatTreatment" defaultValue={supplier?.defaultVatTreatment ?? ""}>
          <option value="">—</option>
          {VAT_TREATMENTS.map((t) => (
            <option key={t} value={t}>
              {VAT_TREATMENT_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
