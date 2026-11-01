import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { configurationFileName, readConfiguration } from "@/lib/product-config";

// GET /requests/:id/configuration — the configurator choices as a .json file,
// ready for `python generate.py --config <file>` in product-tools/.
// Requires a logged-in session.

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const request = await prisma.quoteRequest.findUnique({
    where: { id },
    select: { requestNumber: true, configuration: true },
  });
  const configuration = readConfiguration(request?.configuration);
  if (!request || !configuration) return new Response("Not found", { status: 404 });

  const name = configurationFileName(request.requestNumber, configuration);
  return new Response(JSON.stringify(configuration, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
