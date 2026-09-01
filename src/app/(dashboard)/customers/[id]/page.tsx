import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR, formatDate, formatDateTime } from "@/lib/money";
import { STATUS_LABELS } from "@/server/orders/changeStatus";
import { updateCustomerAction } from "@/lib/catalogue-actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        include: { invoice: true },
      },
      invoices: { orderBy: { createdAt: "desc" }, include: { order: true } },
    },
  });
  if (!customer) notFound();

  const revenue = customer.invoices
    .filter((i) => i.status === "PAID")
    .reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/customers" className="muted small">
          ← Klanten
        </Link>
        <h1>{customer.name}</h1>
        <p className="muted">
          {customer.email}
          {customer.companyName ? ` · ${customer.companyName}` : ""} ·{" "}
          <span className="status-pill">
            {customer.isBusiness ? "Onderneming" : "Particulier"}
          </span>
        </p>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2>Bestellingen ({customer.orders.length})</h2>
            {customer.orders.length === 0 ? (
              <p className="muted small">Nog geen bestellingen.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Totaal</th>
                      <th>Status</th>
                      <th>Factuur</th>
                      <th>Datum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link
                            href={`/orders/${o.id}`}
                            className="link-strong"
                          >
                            #{o.orderNumber}
                          </Link>
                        </td>
                        <td>{formatEUR(o.total.toString())}</td>
                        <td>
                          <span className="status-pill">
                            {STATUS_LABELS[o.status]}
                          </span>
                        </td>
                        <td className="muted small">
                          {o.invoice
                            ? (o.invoice.invoiceNumber ?? "concept")
                            : "—"}
                        </td>
                        <td className="muted small">
                          {formatDateTime(o.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Facturen ({customer.invoices.length})</h2>
            {customer.invoices.length === 0 ? (
              <p className="muted small">Nog geen facturen.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nummer</th>
                      <th>Bestelling</th>
                      <th>Totaal</th>
                      <th>Status</th>
                      <th>Datum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="link-strong"
                          >
                            {inv.invoiceNumber ?? "concept"}
                          </Link>
                        </td>
                        <td className="muted small">
                          #{inv.order.orderNumber}
                        </td>
                        <td>{formatEUR(inv.total.toString())}</td>
                        <td>
                          <span className="status-pill">{inv.status}</span>
                        </td>
                        <td className="muted small">
                          {formatDate(inv.issueDate ?? inv.createdAt)}
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
            <h2>Omzet</h2>
            <p className="stack">
              <span className="stat-value">{formatEUR(revenue)}</span>
              <span className="muted small">Betaalde facturen</span>
            </p>
          </section>

          <section className="panel">
            <h2>Gegevens</h2>
            <form action={updateCustomerAction} className="stack-form">
              <input type="hidden" name="id" value={customer.id} />
              <label className="field">
                Naam
                <input name="name" defaultValue={customer.name} />
              </label>
              <label className="field">
                E-mail
                <input value={customer.email} disabled />
              </label>
              <label className="field">
                Telefoon
                <input name="phone" defaultValue={customer.phone ?? ""} />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="isBusiness"
                  defaultChecked={customer.isBusiness}
                />
                Onderneming
              </label>
              <label className="field">
                Bedrijfsnaam
                <input
                  name="companyName"
                  defaultValue={customer.companyName ?? ""}
                />
              </label>
              <label className="field">
                Btw-nummer
                <input
                  name="vatNumber"
                  defaultValue={customer.vatNumber ?? ""}
                  placeholder="BE0123456789"
                />
              </label>
              <label className="field">
                Straat
                <input
                  name="addressStreet"
                  defaultValue={customer.addressStreet ?? ""}
                />
              </label>
              <label className="field">
                Postcode
                <input
                  name="addressPostal"
                  defaultValue={customer.addressPostal ?? ""}
                />
              </label>
              <label className="field">
                Gemeente
                <input
                  name="addressCity"
                  defaultValue={customer.addressCity ?? ""}
                />
              </label>
              <label className="field">
                Land
                <input
                  name="addressCountry"
                  defaultValue={customer.addressCountry ?? ""}
                />
              </label>
              <label className="field">
                Notities
                <input name="notes" defaultValue={customer.notes ?? ""} />
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
