"use client";

import { useState } from "react";
import Link from "next/link";
import {
  upsertSupplierPriceAction,
  deleteSupplierPriceAction,
  setPreferredSupplierAction,
} from "@/lib/inventory-actions";

export type SupplierPriceRowData = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  productUrl: string | null;
  unitPrice: string; // raw decimal string, for the edit field
  priceLabel: string; // already formatted, e.g. "€ 2,50/stuk"
  packSize: string | null;
  packPrice: string | null;
  minOrderQty: string | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
};

// One supplier price in the "Leveranciers & prijzen" table, with an inline
// edit form. Saving goes through upsertSupplierPriceAction (same action as the
// "add" form), so the preferred-supplier cost sync keeps working.
export default function SupplierPriceRow({
  row,
  materialId,
  unit,
}: {
  row: SupplierPriceRowData;
  materialId: string;
  unit: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <tr>
        <td>
          <Link href={`/suppliers/${row.supplierId}`} className="link-strong">
            {row.supplierName}
          </Link>
        </td>
        <td className="muted small">{row.supplierSku ?? "—"}</td>
        <td>
          {row.priceLabel}
          {row.productUrl && (
            <>
              {" "}
              <a
                href={row.productUrl}
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
          {row.leadTimeDays != null ? `${row.leadTimeDays} d` : "—"}
        </td>
        <td>
          {row.isPreferred ? (
            <span className="status-pill">Voorkeur</span>
          ) : (
            <form action={setPreferredSupplierAction}>
              <input type="hidden" name="materialId" value={materialId} />
              <input type="hidden" name="supplierId" value={row.supplierId} />
              <button className="btn-link" type="submit">
                Als voorkeur
              </button>
            </form>
          )}
        </td>
        <td className="row-action">
          <button
            type="button"
            style={{ display: "block", marginLeft: "auto" }}
            className="btn-link"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Sluiten" : "Bewerken"}
          </button>
          <form action={deleteSupplierPriceAction}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="materialId" value={materialId} />
            <button className="btn-link-danger" type="submit">
              Verwijderen
            </button>
          </form>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6}>
            <form
              action={async (fd) => {
                await upsertSupplierPriceAction(fd);
                setEditing(false);
              }}
              className="form-grid"
            >
              <input type="hidden" name="materialId" value={materialId} />
              <input type="hidden" name="supplierId" value={row.supplierId} />
              {/* Fields without an input here must be sent along, otherwise the
                  update would blank them. */}
              <input type="hidden" name="packSize" value={row.packSize ?? ""} />
              <input type="hidden" name="packPrice" value={row.packPrice ?? ""} />
              <input
                type="hidden"
                name="minOrderQty"
                value={row.minOrderQty ?? ""}
              />
              <label className="field">
                Prijs / {unit} (excl. btw)
                <input
                  name="unitPrice"
                  inputMode="decimal"
                  defaultValue={row.unitPrice}
                  required
                />
              </label>
              <label className="field">
                Leverancier-SKU
                <input name="supplierSku" defaultValue={row.supplierSku ?? ""} />
              </label>
              <label className="field">
                Productlink
                <input
                  name="productUrl"
                  type="url"
                  placeholder="https://…"
                  defaultValue={row.productUrl ?? ""}
                />
              </label>
              <label className="field">
                Levertijd (dagen)
                <input
                  name="leadTimeDays"
                  type="number"
                  min={0}
                  defaultValue={row.leadTimeDays ?? ""}
                />
              </label>
              <label className="check-field form-col-2">
                <input
                  type="checkbox"
                  name="isPreferred"
                  defaultChecked={row.isPreferred}
                />
                Voorkeursleverancier
              </label>
              <div className="form-actions form-col-2">
                <button type="submit" className="btn-ghost btn-ghost--dark">
                  Wijzigingen opslaan
                </button>{" "}
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setEditing(false)}
                >
                  Annuleren
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
