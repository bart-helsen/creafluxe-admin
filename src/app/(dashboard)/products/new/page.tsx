import Link from "next/link";
import { createProductAction } from "@/lib/catalogue-actions";

// Create a catalogue product (Phase 2). Options, bill of materials and master
// files are managed on the detail page once the product exists.

export default function NewProductPage() {
  return (
    <div className="page">
      <header className="page-header">
        <Link href="/products" className="muted small">
          ← Catalogus
        </Link>
        <h1>Nieuw product</h1>
        <p className="muted">
          Voeg de basis toe; opties, stuklijst en masterbestanden regel je
          daarna op de productpagina.
        </p>
      </header>

      <section className="panel">
        <form action={createProductAction} className="form-grid">
          <label className="field">
            SKU *
            <input name="sku" placeholder="bv. HEUP-LEER" required />
          </label>
          <label className="field">
            Naam *
            <input name="name" placeholder="bv. Heup flacon (leer)" required />
          </label>
          <label className="field form-col-2">
            Omschrijving
            <input name="description" placeholder="Optioneel" />
          </label>
          <label className="field">
            Basisprijs (incl. btw) *
            <input name="basePrice" type="text" inputMode="decimal" placeholder="12.00" required />
          </label>
          <label className="field">
            Btw-tarief (%)
            <input name="vatRate" type="text" inputMode="decimal" defaultValue="21" />
          </label>
          <label className="field">
            Filter / categorie
            <input name="filter" placeholder="bv. Flacons" />
          </label>
          <label className="field">
            Sorteervolgorde
            <input name="sortOrder" type="number" defaultValue="0" />
          </label>
          <label className="check-field form-col-2">
            <input type="checkbox" name="active" defaultChecked />
            Actief (zichtbaar in de webshop)
          </label>
          <div className="form-actions form-col-2">
            <button type="submit" className="btn-primary">
              Product aanmaken
            </button>
            <Link href="/products" className="btn-ghost btn-ghost--dark">
              Annuleren
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
