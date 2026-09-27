import { prisma } from "@/lib/db";
import { formatRequestNumber, requestTitle } from "@/lib/requests";
import { buildOfferPdf } from "./offerPdfDocument";

// Load an offer and render its PDF. A draft is dated today (the day you
// download it to send); a sent offer keeps the date it was sent.

export async function renderOfferPdf(offerId: string): Promise<{
  pdf: Buffer;
  offerNumber: string;
}> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      request: { include: { customer: true } },
    },
  });
  if (!offer) throw new Error(`Offer ${offerId} not found`);

  const c = offer.request.customer;
  const pdf = await buildOfferPdf({
    offerNumber: offer.offerNumber,
    version: offer.version,
    date: offer.sentAt ?? new Date(),
    validUntil: offer.validUntil,
    requestNumber: formatRequestNumber(offer.request.requestNumber),
    subject: requestTitle(offer.request),
    customer: {
      name: c.name,
      companyName: c.companyName,
      vatNumber: c.vatNumber,
      email: c.email || null,
      phone: c.phone,
      addressStreet: c.addressStreet,
      addressPostal: c.addressPostal,
      addressCity: c.addressCity,
      addressCountry: c.addressCountry,
    },
    intro: offer.intro,
    terms: offer.terms,
    lines: offer.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toFixed(2),
      vatRate: l.vatRate.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    })),
  });

  return { pdf, offerNumber: offer.offerNumber };
}
