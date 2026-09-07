import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Prisma,
  type MaterialCategory,
  type StockMovementType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEUR, formatDateTime } from "@/lib/money";
import {
  updateMaterialAction,
  upsertSupplierPriceAction,
  deleteSupplierPriceAction,
  setPreferredSupplierAction,
} from "@/lib/inventory-actions";
import MovementForm from "@/components/MovementForm";

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  WOOD: "Hout",
  PLASTIC: "Plastic",
  METAL: "Metaal",
  PAPER: "Papier",
  GADGET: "Gadget",
  CONSUMABLE: "Verbruik",
  OTHER: "Overig",
};

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  PURCHASE: "Aankoop",
  CONSUMPTION: "Verbruik",
  ADJUSTMENT: "Correctie",
  RETURN: "Retour",
  WASTE: "Afval",
};

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const material = await prisma.material.findUnique({
    where: { id },
    include: {
      currentSupplier: true,
      supplierMaterials: {
        include: { supplier: true },
        orderBy: { unitPrice: "asc" },
      },
      stockMovements: {
        take: 40,
        orderBy: { createdAt: "desc" },
        include: { supplier: true, order: true, createdBy: true },
      },
      bomLines: { include: { product: true } },
    },
  });
  if (!material) notFound();

  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const low = new Prisma.Decimal(material.stockQuantity).lte(
    material.reorderLevel,
  );

  // Preferred supplier drives the "order at" link and the order-form defaults.
  const preferred =
    material.supplierMaterials.find((sm) => sm.isPreferred) ?? null;
  const priceBySupplier: Record<string, string> = Object.fromEntries(
    material.supplierMaterials.map((sm) => [
      sm.supplierId,
      sm.unitPrice.toString(),
    ]),
  );
  // Pre-select a supplier so the order form's cost is filled in automatically:
  // the current/preferred one if set, otherwise the cheapest known price.
  const defaultSupplierId =
    material.currentSupplierId ??
    preferred?.supplierId ??
    material.supplierMaterials[0]?.supplierId ??
    "";

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/materials" className="muted small">
            ← Materialen
          </Link>
          <h1>{material.name}</h1>
          <p className="muted">
            {material.sku} · {CATEGORY_LABELS[material.category]} ·{" "}
            <span className={low ? "stock-low" : ""}>
              {Number(material.stockQuantity)} {material.unit} op voorraad
            </span>
            {low && <span className="stock-flag">laag</span>}
          </p>
          {preferred && (
            <p className="muted small">
              Bestellen bij:{" "}
              {preferred.productUrl ? (
                <a
                  href={preferred.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-strong"
                >
                  {preferred.supplier.name}
                </a>
              ) : (
                <Link
                  href={`/suppliers/${preferred.supplierId}`}
                  className="link-strong"
                >
                  {preferred.supplier.name}
                </Link>
              )}{" "}
              · {formatEUR(preferred.unitPrice.toString())}/{material.unit}
            </p>
          )}
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {/* Record a movement */}
          <section className="panel">
            <h2>Voorraadbeweging boeken</h2>
            <p className="small muted">
              Elke aankoop, verbruik of correctie. Het teken volgt automatisch uit
              het type; een aankoop noteert de aankoopprijs bij de gekozen
              leverancier.
            </p>
            <MovementForm
              materialId={material.id}
              unit={material.unit}
              suppliers={suppliers}
              priceBySupplier={priceBySupplier}
              defaultSupplierId={defaultSupplierId}
              defaultUnitCost={material.unitCost.toString()}
            />
          </section>

          {/* Movement history */}
          <section className="panel">
            <h2>Voorraadhistoriek</h2>
            {material.stockMovements.length === 0 ? (
              <p className="muted small">Nog geen bewegingen.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Type</th>
                      <th>Aantal</th>
                      <th>Kost</th>
                      <th>Bron</th>
                    </tr>
                  </thead>
                  <tbody>
                    {material.stockMovements.map((mv) => {
                      const qty = Number(mv.quantity);
                      return (
                        <tr key={mv.id}>
                          <td className="muted small">
                            {formatDateTime(mv.createdAt)}
                          </td>
                          <td>{MOVEMENT_LABELS[mv.type]}</td>
                          <td className={qty < 0 ? "stock-low" : ""}>
                            {qty > 0 ? "+" : ""}
                            {qty} {material.unit}
                          </td>
                          <td className="muted small">
                            {mv.unitCost != null
                              ? formatEUR(mv.unitCost.toString())
                              : "—"}
                          </td>
                          <td className="muted small">
                            {mv.order ? (
                              <Link href={`/orders/${mv.orderId}`}>
                                Bestelling #{mv.order.orderNumber}
                              </Link>
                            ) : mv.supplier ? (
                              mv.supplier.name
                            ) : (
                              (mv.reason ?? "—")
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Supplier prices */}
          <section className="panel">
            <h2>Leveranciers &amp; prijzen</h2>
            <p className="small muted">
              De prijs van dit materiaal geef je hier op — één keer per
              leverancier. De leverancier met <strong>Voorkeur</strong> bepaalt de
              eenheidskost waarmee kostprijzen gerekend worden.
            </p>
            {material.supplierMaterials.length === 0 ? (
              <p className="muted small">Nog geen leveranciersprijzen.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Leverancier</th>
                      <th>SKU</th>
                      <th>Prijs</th>
                      <th>Levertijd</th>
                      <th>Voorkeur</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {material.supplierMaterials.map((sm) => (
                      <tr key={sm.id}>
                        <td>
                          <Link
                            href={`/suppliers/${sm.supplierId}`}
                            className="link-strong"
                          >
                            {sm.supplier.name}
                          </Link>
                        </td>
                        <td className="muted small">{sm.supplierSku ?? "—"}</td>
                        <td>
                          {formatEUR(sm.unitPrice.toString())}/{material.unit}
                          {sm.productUrl && (
                            <>
                              {" "}
                              <a
                                href={sm.productUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="small"
                                title="Productpagina"
                              >
                                ↗
                              </a>
                            </>
                          )}
                        </td>
                        <td className="muted small">
                          {sm.leadTimeDays != null
                            ? `${sm.leadTimeDays} d`
                            : "—"}
                        </td>
                        <td>
                          {sm.isPreferred ? (
                            <span className="status-pill">Voorkeur</span>
                          ) : (
                            <form action={setPreferredSupplierAction}>
                              <input
                                type="hidden"
                                name="materialId"
                                value={material.id}
                              />
                              <input
                                type="hidden"
                                name="supplierId"
                                value={sm.supplierId}
                              />
                              <button className="btn-link" type="submit">
                                Als voorkeur
                              </button>
                            </form>
                          )}
                        </td>
                        <td className="row-action">
                          <form action={deleteSupplierPriceAction}>
                            <input type="hidden" name="id" value={sm.id} />
                            <input
                              type="hidden"
                              name="materialId"
                              value={material.id}
                            />
                            <button className="btn-link-danger" type="submit">
                              Verwijderen
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {suppliers.length > 0 ? (
              <form action={upsertSupplierPriceAction} className="form-grid">
                <input type="hidden" name="materialId" value={material.id} />
                <label className="field">
                  Leverancier
                  <select name="supplierId" required defaultValue="">
                    <option value="" disabled>
                      Kies leverancier…
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Prijs / {material.unit} (excl. btw)
                  <input name="unitPrice" inputMode="decimal" required />
                </label>
                <label className="field">
                  Leverancier-SKU
                  <input name="supplierSku" />
                </label>
                <label className="field">
                  Productlink
                  <input name="productUrl" type="url" placeholder="https://…" />
                </label>
                <label className="field">
                  Levertijd (dagen)
                  <input name="leadTimeDays" type="number" />
                </label>
                <label className="check-field form-col-2">
                  <input type="checkbox" name="isPreferred" />
                  Voorkeursleverancier — deze prijs wordt de eenheidskost voor de
                  kostprijsberekening
                </label>
                <div className="form-actions form-col-2">
                  <button type="submit" className="btn-ghost btn-ghost--dark">
                    Prijs opslaan
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted small">
                Maak eerst een{" "}
                <Link href="/suppliers/new" className="link-strong">
                  leverancier
                </Link>{" "}
                aan.
              </p>
            )}
          </section>
        </div>

        <div className="detail-side">
          {/* BOM usage */}
          <section className="panel">
            <h2>Gebruikt in producten</h2>
            {material.bomLines.length === 0 ? (
              <p className="muted small">
                Dit materiaal zit in geen enkele stuklijst.
              </p>
            ) : (
              <ul className="plain-list">
                {material.bomLines.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/products/${b.productId}`}
                      className="link-strong"
                    >
                      {b.product.name}
                    </Link>
                    <span className="muted small">
                      {" "}
                      · {Number(b.quantity)} {material.unit}/stuk
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Edit material */}
          <section className="panel">
            <h2>Materiaalgegevens</h2>
            <form action={updateMaterialAction} className="stack-form">
              <input type="hidden" name="id" value={material.id} />
              <label className="field">
                Naam *
                <input name="name" defaultValue={material.name} required />
              </label>
              <label className="field">
                Categorie
                <select name="category" defaultValue={material.category}>
                  {(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map(
                    (c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                Eenheid
                <input name="unit" defaultValue={material.unit} />
              </label>
              <div className="field">
                Eenheidskost (excl. btw)
                <p className="readonly-value">
                  {formatEUR(material.unitCost.toString())}/{material.unit}
                  <span className="muted small">
                    {" "}
                    {preferred
                      ? `— van voorkeursleverancier ${preferred.supplier.name}`
                      : "— nog geen voorkeursleverancier; voeg hieronder een prijs toe"}
                  </span>
                </p>
                <p className="muted small" style={{ margin: 0 }}>
                  Wordt automatisch overgenomen van de voorkeursleverancier — pas
                  de prijs aan bij <strong>Leveranciers &amp; prijzen</strong>.
                </p>
              </div>
              <label className="field">
                Minimumvoorraad
                <input
                  name="reorderLevel"
                  inputMode="decimal"
                  defaultValue={material.reorderLevel.toString()}
                />
              </label>
              <label className="field">
                Bestelhoeveelheid
                <input
                  name="reorderQuantity"
                  inputMode="decimal"
                  defaultValue={material.reorderQuantity?.toString() ?? ""}
                />
              </label>
              <label className="field">
                Omschrijving
                <input
                  name="description"
                  defaultValue={material.description ?? ""}
                />
              </label>
              <label className="field">
                Notities
                <input name="notes" defaultValue={material.notes ?? ""} />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={material.active}
                />
                Actief
              </label>
              <button type="submit" className="btn-primary">
                Opslaan
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
