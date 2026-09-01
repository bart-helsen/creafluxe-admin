import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR } from "@/lib/money";
import { updateSupplierAction } from "@/lib/inventory-actions";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      supplierMaterials: {
        include: { material: true },
        orderBy: { material: { name: "asc" } },
      },
    },
  });
  if (!supplier) notFound();

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/suppliers" className="muted small">
          ← Leveranciers
        </Link>
        <h1>{supplier.name}</h1>
        <p className="muted">
          <span className="status-pill">
            {supplier.active ? "Actief" : "Inactief"}
          </span>
        </p>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2>Geleverde materialen ({supplier.supplierMaterials.length})</h2>
            {supplier.supplierMaterials.length === 0 ? (
              <p className="muted small">
                Nog geen materialen. Koppel prijzen op de materiaalpagina.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Materiaal</th>
                      <th>Leverancier-SKU</th>
                      <th>Prijs</th>
                      <th>Voorkeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplier.supplierMaterials.map((sm) => (
                      <tr key={sm.id}>
                        <td>
                          <Link
                            href={`/materials/${sm.materialId}`}
                            className="link-strong"
                          >
                            {sm.material.name}
                          </Link>
                        </td>
                        <td className="muted small">
                          {sm.supplierSku ?? "—"}
                        </td>
                        <td>
                          {formatEUR(sm.unitPrice.toString())}/
                          {sm.material.unit}
                        </td>
                        <td>
                          {sm.isPreferred ? (
                            <span className="status-pill">Voorkeur</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="detail-side">
          <section className="panel">
            <h2>Gegevens</h2>
            <form action={updateSupplierAction} className="stack-form">
              <input type="hidden" name="id" value={supplier.id} />
              <label className="field">
                Naam *
                <input name="name" defaultValue={supplier.name} required />
              </label>
              <label className="field">
                E-mail
                <input name="email" defaultValue={supplier.email ?? ""} />
              </label>
              <label className="field">
                Telefoon
                <input name="phone" defaultValue={supplier.phone ?? ""} />
              </label>
              <label className="field">
                Website
                <input name="website" defaultValue={supplier.website ?? ""} />
              </label>
              <label className="field">
                Jouw klantnummer
                <input
                  name="customerNumber"
                  defaultValue={supplier.customerNumber ?? ""}
                />
              </label>
              <label className="field">
                Straat
                <input
                  name="addressStreet"
                  defaultValue={supplier.addressStreet ?? ""}
                />
              </label>
              <label className="field">
                Postcode
                <input
                  name="addressPostal"
                  defaultValue={supplier.addressPostal ?? ""}
                />
              </label>
              <label className="field">
                Gemeente
                <input
                  name="addressCity"
                  defaultValue={supplier.addressCity ?? ""}
                />
              </label>
              <label className="field">
                Land
                <input
                  name="addressCountry"
                  defaultValue={supplier.addressCountry ?? ""}
                />
              </label>
              <label className="field">
                Notities
                <input name="notes" defaultValue={supplier.notes ?? ""} />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={supplier.active}
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
