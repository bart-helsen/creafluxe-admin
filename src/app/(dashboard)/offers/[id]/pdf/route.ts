import { auth } from "@/lib/auth";
import { renderOfferPdf } from "@/server/offers/renderOfferPdf";

// GET /offers/:id/pdf — the offer as a PDF, rendered on demand from the saved
// offer. Open it, download it and send it to the customer. Requires a
// logged-in session.

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  let result: Awaited<ReturnType<typeof renderOfferPdf>>;
  try {
    result = await renderOfferPdf(id);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return new Response("Not found", { status: 404 });
    }
    console.error(`[offer pdf] ${id}:`, err);
    return new Response("Could not render PDF", { status: 500 });
  }

  // ?download=1 saves the file instead of opening it in the browser.
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="offerte-${result.offerNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
