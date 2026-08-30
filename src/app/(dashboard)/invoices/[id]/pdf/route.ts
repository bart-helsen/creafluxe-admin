import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isR2Configured, getObjectBytes } from "@/lib/r2";
import { renderInvoicePdf } from "@/server/invoices/renderInvoicePdf";

// GET /invoices/:id/pdf — stream the invoice PDF. Serves the stored copy from
// R2 when available, otherwise renders it on demand (so PDFs work even before
// R2 is configured). Requires a logged-in session.

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, invoiceNumber: true, pdfStorageKey: true },
  });
  if (!invoice) return new Response("Not found", { status: 404 });

  let pdf: Buffer;
  try {
    if (invoice.pdfStorageKey && isR2Configured()) {
      pdf = await getObjectBytes(invoice.pdfStorageKey);
    } else {
      pdf = await renderInvoicePdf(invoice.id);
    }
  } catch (err) {
    console.error(`[invoice pdf] ${id}:`, err);
    return new Response("Could not render PDF", { status: 500 });
  }

  const name = invoice.invoiceNumber ?? `concept-${invoice.id.slice(0, 8)}`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="factuur-${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
