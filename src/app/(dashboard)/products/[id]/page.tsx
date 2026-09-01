import Link from "next/link";
import { notFound } from "next/navigation";
import type { ProductOptionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { isR2Configured, presignDownload } from "@/lib/r2";
import { computeProductCost } from "@/server/materials/costing";
import {
  updateProductAction,
  addOptionAction,
  deleteOptionAction,
  uploadMasterAction,
  deleteMasterAction,
} from "@/lib/catalogue-actions";
import {
  upsertBomLineAction,
  deleteBomLineAction,
} from "@/lib/inventory-actions";

const OPTION_TYPE_LABELS: Record<ProductOptionType, string> = {
  MATERIAL: "Materiaal",
  SIZE: "Maat",
  STYLE: "Stijl",
  DESIGN: "Ontwerp",
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      options: { orderBy: [{ type: "asc" }, { sortOrder: "asc" }] },
      designs: { where: { kind: "MASTER" }, orderBy: { createdAt: "desc" } },
      bomLines: { include: { material: true } },
    },
  });
  if (!product) notFound();

  const cost = await computeProductCost(product.id);

  // Materials to offer in the "add BOM line" picker (exclude ones already used).
  const usedMaterialIds = new Set(product.bomLines.map((b) => b.materialId));
  const materials = await prisma.material.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, unit: true, sku: true },
  });

  // Presigned download links for master files (only when R2 is configured).
  const r2 = isR2Configured();
  const masterLinks = new Map<string, string>();
  if (r2) {
    await Promise.all(
      product.designs.map(async (d) => {
        try {
          masterLinks.set(d.id, await presignDownload(d.storageKey));
        } catch {
          /* ignore — show without a link */
        }
      }),
    );
  }

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/products" className="muted small">
            ← Catalogus
          </Link>
          <h1>{product.name}</h1>
          <p className="muted">
            {product.sku} ·{" "}
            <span className="status-pill">
              {product.active ? "Actief" : "Inactief"}
            </span>
          </p>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {/* Edit product */}
          <section className="panel">
            <h2>Productgegevens</h2>
            <form action={updateProductAction} className="form-grid">
              <input type="hidden" name="id" value={product.id} />
              <label className="field">
                SKU
                <input value={product.sku} disabled />
              </label>
              <label className="field">
                Naam *
                <input name="name" defaultValue={product.name} required />
              </label>
              <label className="field form-col-2">
                Omschrijving
                <input
                  name="description"
                  defaultValue={product.description ?? ""}
                />
              </label>
              <label className="field">
                Basisprijs (incl. btw)
                <input
                  name="basePrice"
                  inputMode="decimal"
                  defaultValue={product.basePrice.toString()}
                />
              </label>
              <label className="field">
                Btw-tarief (%)
                <input
                  name="vatRate"
                  inputMode="decimal"
                  defaultValue={product.vatRate.toString()}
                />
              </label>
              <label className="field">
                Filter / categorie
                <input name="filter" defaultValue={product.filter ?? ""} />
              </label>
              <label className="field">
                Sorteervolgorde
                <input
                  name="sortOrder"
                  type="number"
                  defaultValue={product.sortOrder}
                />
              </label>
              <label className="check-field form-col-2">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={product.active}
                />
                Actief
              </label>
              <div className="form-actions form-col-2">
                <button type="submit" className="btn-primary">
                  Opslaan
                </button>
              </div>
            </form>
          </section>

          {/* Options */}
          <section className="panel">
            <h2>Opties</h2>
            {product.options.length === 0 ? (
              <p className="muted small">Nog geen opties.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Waarde</th>
                      <th>Prijsdelta</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.options.map((o) => (
                      <tr key={o.id}>
                        <td>{OPTION_TYPE_LABELS[o.type]}</td>
                        <td>{o.value}</td>
                        <td>{formatEUR(o.priceDelta.toString())}</td>
                        <td className="row-action">
                          <form action={deleteOptionAction}>
                            <input type="hidden" name="id" value={o.id} />
                            <input
                              type="hidden"
                              name="productId"
                              value={product.id}
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

            <form action={addOptionAction} className="inline-form">
              <input type="hidden" name="productId" value={product.id} />
              <select name="type" defaultValue="MATERIAL">
                {(Object.keys(OPTION_TYPE_LABELS) as ProductOptionType[]).map(
                  (t) => (
                    <option key={t} value={t}>
                      {OPTION_TYPE_LABELS[t]}
                    </option>
                  ),
                )}
              </select>
              <input name="value" placeholder="Waarde, bv. Leer" required />
              <input
                name="priceDelta"
                inputMode="decimal"
                placeholder="+ €"
                defaultValue="0.00"
              />
              <button type="submit" className="btn-ghost btn-ghost--dark">
                Toevoegen
              </button>
            </form>
          </section>

          {/* Bill of materials + costing */}
          <section className="panel">
            <h2>Stuklijst &amp; kostprijs</h2>
            <p className="small muted">
              Materiaalverbruik per stuk. Hieruit berekent de app de kostprijs en
              een richtprijs (kostprijs × markup {cost.markupPercent}%).
            </p>
            {product.bomLines.length === 0 ? (
              <p className="muted small">Nog geen materialen gekoppeld.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Materiaal</th>
                      <th>Aantal</th>
                      <th>Eenheidskost</th>
                      <th>Lijnkost</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.lines.map((l) => (
                      <tr key={l.materialId}>
                        <td>{l.name}</td>
                        <td>
                          {l.quantity} {l.unit}
                        </td>
                        <td>{formatEUR(l.unitCost)}</td>
                        <td>{formatEUR(l.lineCost)}</td>
                        <td className="row-action">
                          <form action={deleteBomLineAction}>
                            <input
                              type="hidden"
                              name="id"
                              value={
                                product.bomLines.find(
                                  (b) => b.materialId === l.materialId,
                                )?.id
                              }
                            />
                            <input
                              type="hidden"
                              name="productId"
                              value={product.id}
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

            <div className="totals-box">
              <div className="totals-line">
                <span>Materiaalkost</span>
                <span>{formatEUR(cost.materialCost)}</span>
              </div>
              <div className="totals-line totals-line--strong">
                <span>Richtprijs (excl. btw)</span>
                <span>{formatEUR(cost.suggestedPrice)}</span>
              </div>
            </div>

            {materials.length > 0 && (
              <form action={upsertBomLineAction} className="inline-form">
                <input type="hidden" name="productId" value={product.id} />
                <select name="materialId" required defaultValue="">
                  <option value="" disabled>
                    Kies materiaal…
                  </option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                      {usedMaterialIds.has(m.id) ? " — bijwerken" : ""}
                    </option>
                  ))}
                </select>
                <input
                  name="quantity"
                  inputMode="decimal"
                  placeholder="Aantal per stuk"
                  required
                />
                <button type="submit" className="btn-ghost btn-ghost--dark">
                  Toevoegen
                </button>
              </form>
            )}
          </section>
        </div>

        {/* Sidebar: master files */}
        <div className="detail-side">
          <section className="panel">
            <h2>Masterbestanden</h2>
            <p className="small muted">
              De herbruikbare ontwerpbestanden die je opent om dit product te
              maken.
            </p>
            {product.designs.length === 0 ? (
              <p className="muted small">Nog geen masterbestanden.</p>
            ) : (
              <div className="files files--stacked">
                {product.designs.map((d) => {
                  const url = masterLinks.get(d.id);
                  return (
                    <div key={d.id} className="file-row">
                      <span className="file-chip">
                        <span className="file-kind">MASTER</span>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {d.label ?? d.fileName}
                          </a>
                        ) : (
                          <span title={d.storageKey}>
                            {d.label ?? d.fileName}
                          </span>
                        )}
                      </span>
                      {d.designValue && (
                        <span className="muted small">→ {d.designValue}</span>
                      )}
                      <form action={deleteMasterAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="hidden"
                          name="productId"
                          value={product.id}
                        />
                        <button className="btn-link-danger" type="submit">
                          ✕
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}

            {r2 ? (
              <form action={uploadMasterAction} className="stack-form">
                <input type="hidden" name="productId" value={product.id} />
                <input type="file" name="file" required />
                <input name="label" placeholder="Label (optioneel)" />
                <input
                  name="designValue"
                  placeholder="Koppel aan ontwerp-optie (optioneel)"
                />
                <button type="submit" className="btn-ghost btn-ghost--dark">
                  Masterbestand uploaden
                </button>
              </form>
            ) : (
              <p className="muted small">
                Bestandsopslag (R2) is niet geconfigureerd — stel R2 in om
                masterbestanden te uploaden.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
