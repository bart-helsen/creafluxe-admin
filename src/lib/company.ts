// Your business's own details, printed on every invoice (legal requirement:
// an invoice must show your name, address, VAT number, and dates — docs/06).
// Sourced from environment variables so nothing sensitive is hard-coded; sane
// Creafluxe defaults let the PDF render before you set them. Fill these on
// Railway (and .env) with your real, accountant-approved values.

export const company = {
  name: process.env.COMPANY_NAME ?? "Creafluxe",
  vatNumber: process.env.COMPANY_VAT ?? "",
  email: process.env.COMPANY_EMAIL ?? "info@creafluxe.be",
  phone: process.env.COMPANY_PHONE ?? "",
  website: process.env.COMPANY_WEBSITE ?? "creafluxe.be",
  iban: process.env.COMPANY_IBAN ?? "",
  addressStreet: process.env.COMPANY_ADDRESS_STREET ?? "",
  addressPostal: process.env.COMPANY_ADDRESS_POSTAL ?? "",
  addressCity: process.env.COMPANY_ADDRESS_CITY ?? "",
  addressCountry: process.env.COMPANY_ADDRESS_COUNTRY ?? "België",
  /** Days until an invoice is due, used to compute dueDate at issue time. */
  paymentTermDays: Number(process.env.COMPANY_PAYMENT_TERM_DAYS ?? "14"),
};

export function companyAddressLines(): string[] {
  return [
    company.addressStreet,
    [company.addressPostal, company.addressCity].filter(Boolean).join(" "),
    company.addressCountry,
  ].filter((l) => l && l.trim().length > 0);
}

// Defaults for new offers (Offertes). The texts are pre-filled on every new
// offer and can be changed per offer before you send it.
export const offerDefaults = {
  /** Days an offer stays valid, used to pre-fill "Geldig tot". */
  validityDays: Number(process.env.OFFER_VALIDITY_DAYS ?? "30"),
  terms:
    process.env.OFFER_TERMS ??
    [
      "Levertermijn: ± 1 week voor kleine opdrachten, 2 à 3 weken voor grotere opdrachten, te rekenen vanaf je akkoord.",
      "Afhaling in ons atelier, of levering tegen de vermelde kost.",
      "Akkoord? Bevestig deze offerte per e-mail of stuur ze ondertekend terug.",
    ].join("\n"),
};

/** The default greeting above the offer lines. */
export function defaultOfferIntro(customerName: string): string {
  const first = customerName.trim().split(/\s+/)[0] || customerName;
  return `Beste ${first},\n\nBedankt voor je aanvraag. Hieronder vind je onze prijsofferte.`;
}
