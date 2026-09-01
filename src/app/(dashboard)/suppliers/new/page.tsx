import Link from "next/link";
import { createSupplierAction } from "@/lib/inventory-actions";

export default function NewSupplierPage() {
  return (
    <div className="page">
      <header className="page-header">
        <Link href="/suppliers" className="muted small">
          ← Leveranciers
        </Link>
        <h1>Nieuwe leverancier</h1>
      </header>

      <section className="panel">
        <form action={createSupplierAction} className="form-grid">
          <label className="field form-col-2">
            Naam *
            <input name="name" required />
          </label>
          <label className="field">
            E-mail
            <input name="email" type="email" />
          </label>
          <label className="field">
            Telefoon
            <input name="phone" />
          </label>
          <label className="field">
            Website
            <input name="website" placeholder="https://" />
          </label>
          <label className="field">
            Jouw klantnummer
            <input name="customerNumber" />
          </label>
          <label className="field">
            Straat
            <input name="addressStreet" />
          </label>
          <label className="field">
            Postcode
            <input name="addressPostal" />
          </label>
          <label className="field">
            Gemeente
            <input name="addressCity" />
          </label>
          <label className="field">
            Land
            <input name="addressCountry" defaultValue="België" />
          </label>
          <label className="field form-col-2">
            Notities
            <input name="notes" />
          </label>
          <div className="form-actions form-col-2">
            <button type="submit" className="btn-primary">
              Leverancier aanmaken
            </button>
            <Link href="/suppliers" className="btn-ghost btn-ghost--dark">
              Annuleren
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
