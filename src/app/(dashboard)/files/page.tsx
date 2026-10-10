import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/money";
import { isR2Configured, presignDownload } from "@/lib/r2";
import { formatRequestNumber } from "@/lib/requests";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import { setFileMasterAction } from "@/lib/design-file-actions";

// File library: every design file you chose to keep as a master, wherever it
// hangs — on a catalogue product, on an order or on a request. Search by file
// name, label, customer or product, open the file, jump to where it was used.
// A file becomes a master with "Bewaar als master" on the order page.

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? "").trim();

  const contains = (field: string) => ({ [field]: { contains: search, mode: "insensitive" as const } });
  const customerMatch = (path: "order" | "request"): Prisma.DesignAssetWhereInput[] => {
    const customer: Prisma.CustomerWhereInput = {
      OR: [contains("name"), contains("companyName"), contains("email")],
    };
    return path === "order"
      ? [{ orderItem: { order: { customer } } }]
      : [{ request: { customer } }];
  };

  const where: Prisma.DesignAssetWhereInput = {
    kind: "MASTER",
    ...(search
      ? {
          OR: [
            { label: { contains: search, mode: "insensitive" } },
            { fileName: { contains: search, mode: "insensitive" } },
            { product: { name: { contains: search, mode: "insensitive" } } },
            ...customerMatch("order"),
            ...customerMatch("request"),
          ],
        }
      : {}),
  };

  const assets = await prisma.designAsset.findMany({
    where,
    include: {
      product: { select: { id: true, name: true } },
      orderItem: {
        select: {
          nameSnapshot: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              customer: { select: { id: true, name: true, companyName: true } },
            },
          },
        },
      },
      request: {
        select: {
          id: true,
          requestNumber: true,
          customer: { select: { id: true, name: true, companyName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const r2On = isR2Configured();
  const rows = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      url: r2On ? await presignDownload(a.storageKey) : null,
      customer: a.orderItem?.order.customer ?? a.request?.customer ?? null,
    })),
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Bestanden</h1>
        <p className="muted">
          Je masterbestanden op één plek — ook die van maatwerk zonder catalogusproduct. Een
          bestand komt hier terecht via <em>Bewaar als master</em> op de bestelling.
        </p>
      </header>

      <div className="tabs">
        <form className="tab-search" action="/files">
          <input
            type="search"
            name="q"
            placeholder="Zoek op bestand, omschrijving, klant of product"
            defaultValue={search}
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="panel">
          <p className="muted">
            {search
              ? "Geen bestanden gevonden."
              : "Nog geen masterbestanden. Open een bestelling en kies Bewaar als master bij een bestand."}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Bestand</th>
                <th>Klant</th>
                <th>Herkomst</th>
                <th>Toegevoegd</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className="link-strong">
                        {a.label ?? a.fileName}
                      </a>
                    ) : (
                      <span title={a.storageKey}>{a.label ?? a.fileName}</span>
                    )}
                    {a.label && a.label !== a.fileName && (
                      <div className="muted small">{a.fileName}</div>
                    )}
                  </td>
                  <td>
                    {a.customer ? (
                      <Link href={`/customers/${a.customer.id}`} className="link-strong">
                        {a.customer.companyName ?? a.customer.name}
                      </Link>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td className="small">
                    {a.product && (
                      <Link href={`/products/${a.product.id}`} className="link-strong">
                        Product: {a.product.name}
                      </Link>
                    )}
                    {!a.product && a.orderItem && (
                      <Link href={`/orders/${a.orderItem.order.id}`} className="link-strong">
                        Bestelling #{a.orderItem.order.orderNumber}
                      </Link>
                    )}
                    {!a.product && !a.orderItem && a.request && (
                      <Link href={`/requests/${a.request.id}`} className="link-strong">
                        Aanvraag {formatRequestNumber(a.request.requestNumber)}
                      </Link>
                    )}
                  </td>
                  <td className="muted small">{formatDate(a.createdAt)}</td>
                  <td className="row-action">
                    {!a.product && (
                      <ActionForm action={setFileMasterAction} className="inline-actions">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="master" value="0" />
                        <SubmitButton className="btn-link" pendingLabel="…">
                          Geen master meer
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
