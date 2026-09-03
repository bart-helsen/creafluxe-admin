import Link from "next/link";
import type { MaterialCategory } from "@prisma/client";
import { createMaterialAction } from "@/lib/inventory-actions";

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  WOOD: "Hout",
  PLASTIC: "Plastic",
  METAL: "Metaal",
  PAPER: "Papier",
  GADGET: "Gadget",
  CONSUMABLE: "Verbruik",
  OTHER: "Overig",
};

export default function NewMaterialPage() {
  return (
    <div className="page">
      <header className="page-header">
        <Link href="/materials" className="muted small">
          ← Materialen
        </Link>
        <h1>Nieuw materiaal</h1>
        <p className="muted">
          De beginvoorraad boek je daarna als een aankoop of correctie, zodat de
          voorraadhistoriek klopt.
        </p>
      </header>

      <section className="panel">
        <form action={createMaterialAction} className="form-grid">
          <label className="field">
            SKU *
            <input name="sku" placeholder="bv. WOOD-BERK-3MM" required />
          </label>
          <label className="field">
            Naam *
            <input name="name" placeholder="Berken multiplex 3mm" required />
          </label>
          <label className="field">
            Categorie
            <select name="category" defaultValue="OTHER">
              {(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Eenheid
            <input name="unit" defaultValue="stuk" placeholder="plaat, m2, kg…" />
          </label>
          <label className="field">
            Eenheidskost (excl. btw)
            <input name="unitCost" inputMode="decimal" defaultValue="0.00" />
          </label>
          <label className="field">
            Minimumvoorraad
            <input name="reorderLevel" inputMode="decimal" defaultValue="0" />
          </label>
          <label className="field">
            Bestelhoeveelheid
            <input name="reorderQuantity" inputMode="decimal" placeholder="Optioneel" />
          </label>
          <label className="field">
            Bestellen bij
            <input name="reorderStore" placeholder="bv. Kevelam" />
          </label>
          <label className="field">
            Webshoplink
            <input name="reorderUrl" type="url" placeholder="https://…" />
          </label>
          <label className="field form-col-2">
            Omschrijving
            <input name="description" placeholder="Optioneel" />
          </label>
          <label className="field form-col-2">
            Notities
            <input name="notes" placeholder="Optioneel" />
          </label>
          <div className="form-actions form-col-2">
            <button type="submit" className="btn-primary">
              Materiaal aanmaken
            </button>
            <Link href="/materials" className="btn-ghost btn-ghost--dark">
              Annuleren
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
