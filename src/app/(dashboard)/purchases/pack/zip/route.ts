import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayInBrussels } from "@/lib/purchase-checks";
import { isR2Configured, getObjectBytes } from "@/lib/r2";
import { buildPackCsv, packFileName, uniqueNames, type PackInvoice } from "@/server/purchases/dexxterPack";
import { isoDate } from "@/server/purchases/purchaseInvoices";
import { createZip, type ZipEntry } from "@/server/purchases/zip";

// GET /purchases/pack/zip?ids=a,b,c — the Dexxter pack: the CHECKED invoices'
// files renamed YYYY-MM-DD_supplier_invoicenumber.pdf, plus samenvatting.csv.
// `ids` pins the pack to exactly the invoices shown on the pack page (so the
// later "mark as uploaded" matches what you downloaded); without it, every
// CHECKED invoice is included. Downloading changes nothing — marking is a
// separate, deliberate step. Requires a logged-in session.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const idsParam = new URL(req.url).searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;

  const rows = await prisma.purchaseInvoice.findMany({
    where: { status: "CHECKED", ...(ids ? { id: { in: ids } } : {}) },
    orderBy: [{ invoiceDate: "asc" }, { receivedAt: "asc" }],
  });
  if (rows.length === 0) return new Response("Geen facturen klaar voor Dexxter.", { status: 404 });

  const invoices: (PackInvoice & { fileKey: string | null })[] = rows.map((r) => ({
    id: r.id,
    supplierName: r.supplierName,
    supplierCountry: r.supplierCountry,
    supplierVatNumber: r.supplierVatNumber,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: isoDate(r.invoiceDate),
    receivedAt: todayInBrussels(r.receivedAt),
    currency: r.currency,
    netAmount: r.netAmount?.toString() ?? null,
    vatAmount: r.vatAmount?.toString() ?? null,
    grossAmount: r.grossAmount?.toString() ?? null,
    amountEur: r.amountEur?.toString() ?? null,
    vatTreatment: r.vatTreatment,
    category: r.category,
    notes: r.notes,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileKey: r.fileKey,
  }));

  const r2 = isR2Configured();
  const names = uniqueNames(invoices.map((inv) => packFileName(inv)));
  const entries: ZipEntry[] = [];
  const csvNames: string[] = [];

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    if (!inv.fileKey || !r2) {
      csvNames.push("");
      continue;
    }
    try {
      entries.push({ name: names[i], data: await getObjectBytes(inv.fileKey), date: rows[i].receivedAt });
      csvNames.push(names[i]);
    } catch (err) {
      console.error(`[dexxter pack] file for ${inv.id} failed:`, err);
      csvNames.push(`(ontbreekt: ${names[i]})`);
    }
  }

  const today = todayInBrussels();
  entries.push({
    name: `samenvatting-${today}.csv`,
    data: Buffer.from(buildPackCsv(invoices, csvNames), "utf8"),
  });

  const zip = createZip(entries);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dexxter-pakket-${today}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
