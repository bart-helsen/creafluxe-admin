import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isR2Configured, getObjectBytes } from "@/lib/r2";

// GET /purchases/:id/file — stream the invoice file (PDF/photo) from R2 for the
// review preview. Same-origin, so it embeds in the page without CORS or
// expiring links. Requires a logged-in session.

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    select: { fileKey: true, fileName: true, mimeType: true },
  });
  if (!invoice?.fileKey) return new Response("Not found", { status: 404 });
  if (!isR2Configured()) return new Response("File storage (R2) is not configured", { status: 501 });

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(invoice.fileKey);
  } catch (err) {
    console.error(`[purchase file] ${id}:`, err);
    return new Response("Could not load file", { status: 500 });
  }

  // Header values must be ASCII: plain fallback + the UTF-8 name (RFC 6266).
  const name = invoice.fileName ?? "factuur";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": invoice.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
