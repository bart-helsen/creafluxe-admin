"use client";

import { useState } from "react";
import type { StockMovementType } from "@prisma/client";
import { recordMovementAction } from "@/lib/inventory-actions";

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  PURCHASE: "Aankoop",
  CONSUMPTION: "Verbruik",
  ADJUSTMENT: "Correctie",
  RETURN: "Retour",
  WASTE: "Afval",
};

// The stock-movement ("book a purchase / consumption / correction") form.
// A client component so a purchase can reuse what the material already knows:
// it defaults to the preferred supplier and its price, and picking another
// supplier auto-fills that supplier's saved price — no re-typing.
export default function MovementForm({
  materialId,
  unit,
  suppliers,
  priceBySupplier,
  defaultSupplierId,
  defaultUnitCost,
}: {
  materialId: string;
  unit: string;
  suppliers: { id: string; name: string }[];
  priceBySupplier: Record<string, string>;
  defaultSupplierId: string;
  defaultUnitCost: string;
}) {
  const [type, setType] = useState<StockMovementType>("PURCHASE");
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [unitCost, setUnitCost] = useState(
    priceBySupplier[defaultSupplierId] ?? defaultUnitCost,
  );

  function onSupplierChange(id: string) {
    setSupplierId(id);
    // Auto-fill the saved price for that supplier, if we have one.
    if (priceBySupplier[id]) setUnitCost(priceBySupplier[id]);
  }

  const isPurchase = type === "PURCHASE";

  return (
    <form action={recordMovementAction} className="form-grid">
      <input type="hidden" name="materialId" value={materialId} />
      <label className="field">
        Type
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as StockMovementType)}
        >
          {(Object.keys(MOVEMENT_LABELS) as StockMovementType[]).map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Aantal ({unit})
        <input name="quantity" inputMode="decimal" required />
      </label>
      <label className="field">
        Leverancier (bij aankoop)
        <select
          name="supplierId"
          value={supplierId}
          onChange={(e) => onSupplierChange(e.target.value)}
          disabled={!isPurchase}
        >
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Aankoopprijs (bij aankoop)
        <input
          name="unitCost"
          inputMode="decimal"
          placeholder="excl. btw"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          disabled={!isPurchase}
        />
      </label>
      <label className="field form-col-2">
        Reden / notitie
        <input name="reason" placeholder="Optioneel" />
      </label>
      <div className="form-actions form-col-2">
        <button type="submit" className="btn-primary">
          Beweging boeken
        </button>
        <span className="muted small">
          Correctie mag negatief zijn (bv. −2 om af te boeken).
        </span>
      </div>
    </form>
  );
}
