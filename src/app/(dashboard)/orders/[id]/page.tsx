import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatEUR, formatDateTime } from "@/lib/money";
import {
  ALL_STATUSES,
  STATUS_LABELS,
} from "@/server/orders/changeStatus";
import { gatherOrderDesigns } from "@/server/designs/gatherOrderDesigns";
import {
  changeStatusAction,
  regenerateInvoiceAction,
} from "@/lib/dashboard-actions";
import { channelLabel } from "@/lib/manual-order";
import OrderEditPanel from "@/components/OrderEditPanel";
import type { Line, PickerProduct } from "@/components/OrderLinesEditor";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { customDesigns: true } } },
      },
      invoice: true,
      statusEvents: {
        orderBy: { createdAt: "desc" },
        include: { changedBy: true },
      },
    },
  });
  if (!order) notFound();

  const designs = await gatherOrderDesigns(order.id);

  // Catalogue for the "Bestelling bewerken" panel: active products plus any
  // (possibly inactive) product this order already uses.
  const usedProductIds = order.items
    .map((it) => it.productId)
    .filter((id): id is string => !!id);
  const catalogue = await prisma.product.findMany({
    where: { OR: [{ active: true }, { id: { in: usedProductIds } }] },
    include: {
      options: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { value: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const pickerProducts: PickerProduct[] = catalogue.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    basePrice: p.basePrice.toFixed(2),
    vatRate: p.vatRate.toFixed(0),
    active: p.active,
    options: p.options.map((o) => ({
      type: o.type,
      value: o.value,
      priceDelta: o.priceDelta.toFixed(2),
    })),
  }));
  const editLines: Line[] = order.items.map((it, i) => ({
    key: i + 1,
    id: it.id,
    fileCount: it._count.customDesigns,
    productId: it.productId ?? "",
    name: it.nameSnapshot,
    unitPrice: it.unitPrice.toFixed(2).replace(".", ","),
    quantity: String(it.quantity),
    vatRate: it.vatRate.toFixed(0),
    material: it.material ?? "",
    size: it.size ?? "",
    style: it.style ?? "",
    design: it.design ?? "",
    remarks: it.remarks ?? "",
  }));
  const editLockedReason =
    order.invoice && order.invoice.status !== "DRAFT"
      ? `De factuur ${order.invoice.invoiceNumber ?? ""} is al uitgereikt, dus deze bestelling kan niet meer aangepast worden. Maak een creditnota of een aparte bestelling voor het verschil.`
      : null;
  const designByItem = new Map(designs.map((d) => [d.orderItemId, d.files]));

  const delivery = order.deliveryRequested
    ? [
        order.deliveryStreet,
        [order.deliveryPostal, order.deliveryCity].filter(Boolean).join(" "),
        order.deliveryCountry,
        order.deliveryNotes,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Afhaling";

  return (
    <div className="page">
      <header className="page-header detail-header">
        <div>
          <Link href="/orders" className="muted small">
            ← Bestellingen
          </Link>
          <h1>Bestelling #{order.orderNumber}</h1>
          <p className="muted">
            {order.type} · via {channelLabel(order.channel).toLowerCase()} ·
            ontvangen {formatDateTime(order.createdAt)} ·{" "}
            <span className="status-pill">{STATUS_LABELS[order.status]}</span>
          </p>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {/* Items + design files */}
          <section className="panel">
            <h2>Artikelen &amp; ontwerpbestanden</h2>
            {order.items.length === 0 && (
              <p className="muted">Geen catalogusartikelen (custom aanvraag).</p>
            )}
            {order.items.map((it) => {
              const files = designByItem.get(it.id) ?? [];
              const opts = [it.material, it.size, it.style, it.design]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={it.id} className="item-block">
                  <div className="item-head">
                    <div>
                      <strong>{it.nameSnapshot}</strong>
                      {opts && <div className="muted small">{opts}</div>}
                      {it.remarks && (
                        <div className="small">✏️ {it.remarks}</div>
                      )}
                    </div>
                    <div className="item-price">
                      {it.quantity} × {formatEUR(it.unitPrice.toString())}
                      <div className="muted small">
                        {formatEUR(it.lineTotal.toString())}
                      </div>
                    </div>
                  </div>
                  <div className="files">
                    {files.length === 0 && (
                      <span className="muted small">
                        Geen ontwerpbestanden gekoppeld.
                      </span>
                    )}
                    {files.map((f) => (
                      <span key={f.id} className="file-chip">
                        <span className="file-kind">
                          {f.kind === "MASTER" ? "MASTER" : "UPLOAD"}
                        </span>
                        {f.downloadUrl ? (
                          <a href={f.downloadUrl} target="_blank" rel="noreferrer">
                            {f.label}
                          </a>
                        ) : (
                          <span title={f.storageKey}>{f.label}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}

            {order.designBrief && (
              <div className="brief">
                <h3>Ontwerpbriefing</h3>
                <p>{order.designBrief}</p>
              </div>
            )}

            <div className="totals-line">
              <span>Subtotaal (excl. btw)</span>
              <span>{formatEUR(order.subtotal.toString())}</span>
            </div>
            <div className="totals-line totals-line--strong">
              <span>Totaal (incl. btw)</span>
              <span>{formatEUR(order.total.toString())}</span>
            </div>
          </section>

          <OrderEditPanel
            orderId={order.id}
            initialLines={editLines}
            currentTotal={order.total.toFixed(2)}
            products={pickerProducts}
            lockedReason={editLockedReason}
          />

          {/* Status timeline */}
          <section className="panel">
            <h2>Statusgeschiedenis</h2>
            <ol className="timeline">
              {order.statusEvents.map((e) => (
                <li key={e.id}>
                  <div className="timeline-dot" />
                  <div>
                    <strong>
                      {e.fromStatus === e.toStatus
                        ? "Bestelling aangepast"
                        : STATUS_LABELS[e.toStatus]}
                    </strong>
                    {e.fromStatus && e.fromStatus !== e.toStatus && (
                      <span className="muted small">
                        {" "}
                        ← {STATUS_LABELS[e.fromStatus]}
                      </span>
                    )}
                    <div className="muted small">
                      {formatDateTime(e.createdAt)}
                      {e.changedBy ? ` · ${e.changedBy.name ?? e.changedBy.email}` : ""}
                    </div>
                    {e.note && <div className="small">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Sidebar: customer, status control, invoice */}
        <div className="detail-side">
          <section className="panel">
            <h2>Klant</h2>
            <p className="stack">
              {order.customer.companyName && (
                <strong>{order.customer.companyName}</strong>
              )}
              <span>{order.customer.name}</span>
              <Link href={`/customers/${order.customer.id}`} className="link-strong">
                Klantfiche →
              </Link>
              {order.customer.email && (
                <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
              )}
              {order.customer.phone && <span>{order.customer.phone}</span>}
              {order.customer.isBusiness && (
                <span className="muted small">
                  Onderneming{order.customer.vatNumber ? ` · ${order.customer.vatNumber}` : ""}
                </span>
              )}
            </p>
            <h3>Levering</h3>
            <p className="small">{delivery}</p>
            {order.customerRemarks && (
              <>
                <h3>Opmerkingen klant</h3>
                <p className="small">{order.customerRemarks}</p>
              </>
            )}
          </section>

          <section className="panel">
            <h2>Status wijzigen</h2>
            <form action={changeStatusAction} className="stack-form">
              <input type="hidden" name="orderId" value={order.id} />
              <select name="toStatus" defaultValue={order.status}>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <input name="note" placeholder="Notitie (optioneel)" />
              <button type="submit" className="btn-primary">
                Status opslaan
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Factuur</h2>
            {order.invoice ? (
              <p className="stack">
                <span>
                  <span className="status-pill">{order.invoice.status}</span>{" "}
                  {order.invoice.invoiceNumber ?? "concept"}
                </span>
                <span>{formatEUR(order.invoice.total.toString())}</span>
                <Link href={`/invoices/${order.invoice.id}`} className="link-strong">
                  Factuur openen →
                </Link>
              </p>
            ) : (
              <p className="muted small">Nog geen factuur.</p>
            )}
            <form action={regenerateInvoiceAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <button type="submit" className="btn-ghost btn-ghost--dark">
                {order.invoice ? "Concept herberekenen" : "Concept aanmaken"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
