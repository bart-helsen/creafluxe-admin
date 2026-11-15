import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isR2Configured, getObjectBytes } from "@/lib/r2";
import { renderCreditNotePdf } from "@/server/invoices/renderCreditNotePdf";

// GET /credit-notes/:id/pdf — stream the credit note PDF. Serves the stored
// copy from R2 when available, otherwise renders it on demand. Requires a
// logged-in session.

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
  const cn = await prisma.creditNote.findUnique({
    where: { id },
    select: { id: true, creditNoteNumber: true, pdfStorageKey: true },
  });
  if (!cn) return new Response("Not found", { status: 404 });

  let pdf: Buffer;
  try {
    if (cn.pdfStorageKey && isR2Configured()) {
      pdf = await getObjectBytes(cn.pdfStorageKey);
    } else {
      pdf = await renderCreditNotePdf(cn.id);
    }
  } catch (err) {
    console.error(`[credit note pdf] ${id}:`, err);
    return new Response("Could not render PDF", { status: 500 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="creditnota-${cn.creditNoteNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
