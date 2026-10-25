import { countryFromVatNumber, vatNumberMatchesCountry } from "@/lib/purchase-checks";
import { normalizeVatNumber, parseAmount, toCents, centsToAmount } from "@/lib/purchases";

// Best-effort prefill from a PDF's embedded text, with plain pattern matching.
// No AI, no external service: it looks for labelled values ("Invoice no.",
// "Rechnungsdatum", "Totaal", "MwSt" ...) in the languages EU suppliers use, and
// returns SUGGESTIONS only. Anything it can't find stays empty; every value is
// editable in the review form and nothing counts until you confirm it.

export interface ParsedInvoiceText {
  invoiceNumber?: string;
  invoiceDate?: string; // YYYY-MM-DD
  currency?: string;
  netAmount?: string;
  vatAmount?: string;
  grossAmount?: string;
  supplierVatNumber?: string;
  supplierCountry?: string;
  /** The text mentions reverse charge / btw verlegd / Steuerschuldnerschaft. */
  reverseCharge: boolean;
  /** Which fields were found (keys of this object). */
  found: string[];
  /** 0–100: how much of the invoice could be read, and whether amounts add up. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {};
[
  ["january", "jan", "januar", "januari", "janvier", "janv", "gennaio", "gen", "enero", "ene"],
  ["february", "feb", "februar", "februari", "février", "fevrier", "févr", "fevr", "febbraio", "febrero"],
  ["march", "mar", "märz", "marz", "maerz", "maart", "mars", "marzo", "mrt"],
  ["april", "apr", "avril", "aprile", "abril", "abr"],
  ["may", "mai", "mei", "maggio", "mayo", "mag", "may"],
  ["june", "jun", "juni", "juin", "giugno", "junio", "giu"],
  ["july", "jul", "juli", "juillet", "luglio", "julio", "lug"],
  ["august", "aug", "augustus", "août", "aout", "agosto", "ago"],
  ["september", "sep", "sept", "septembre", "settembre", "septiembre", "set"],
  ["october", "oct", "oktober", "okt", "octobre", "ottobre", "octubre", "ott"],
  ["november", "nov", "novembre", "noviembre"],
  ["december", "dec", "dezember", "dez", "décembre", "decembre", "dicembre", "diciembre", "dic"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const DATE_PATTERNS: { re: RegExp; parse: (m: RegExpExecArray) => [number, number, number] | null }[] = [
  // 2026-03-14
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, parse: (m) => [+m[1], +m[2], +m[3]] },
  // 14.03.2026, 14/03/2026, 14-03-2026 (European order — EU suppliers)
  { re: /\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/, parse: (m) => [+m[3], +m[2], +m[1]] },
  // 14.03.26
  { re: /\b(\d{1,2})[./](\d{1,2})[./](\d{2})\b/, parse: (m) => [2000 + +m[3], +m[2], +m[1]] },
  // 14 March 2026, 14. März 2026, 14 mars 2026
  {
    re: new RegExp(`\\b(\\d{1,2})\\.?\\s*(?:de\\s+)?(${MONTH_NAMES})\\.?\\s*(?:de\\s+)?(20\\d{2})\\b`, "i"),
    parse: (m) => [+m[3], MONTHS[m[2].toLowerCase()], +m[1]],
  },
  // March 14, 2026
  {
    re: new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "i"),
    parse: (m) => [+m[3], MONTHS[m[1].toLowerCase()], +m[2]],
  },
];

/** The first valid date in a piece of text, as YYYY-MM-DD. */
export function findDate(text: string): string | undefined {
  let best: { index: number; iso: string } | undefined;
  for (const { re, parse } of DATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const parts = parse(m);
    if (!parts) continue;
    const [y, mo, d] = parts;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (!mo || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!best || m.index < best.index) best = { index: m.index, iso };
  }
  return best?.iso;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const INVOICE_NUMBER_LABEL =
  /(invoice\s*(?:no\.?|number|nr\.?|num\.?|#|id)|rechnungs?\s*-?\s*(?:nummer|nr\.?|no\.?)|rechnung\s*#|factuur\s*-?\s*(?:nummer|nr\.?|no\.?)|num[ée]ro\s*de\s*(?:la\s*)?facture|facture\s*(?:n[°ºo]\.?|num[ée]ro)|n[°º]\s*de\s*facture|numero\s*(?:di\s*|della\s*)?fattura|fattura\s*n[°º.o]*|n[úu]mero\s*de\s*factura|factura\s*n[°º.o]*|faktura\s*(?:nr|numer)\.?|fakturanummer|fakturanr\.?|invoice)(?![a-z])/i;

const INVOICE_DATE_LABEL =
  /(invoice\s*date|date\s*of\s*(?:issue|invoice)|issue\s*date|date\s*issued|rechnungsdatum|datum\s*der\s*rechnung|factuurdatum|datum\s*factuur|date\s*de\s*(?:la\s*)?facture|data\s*(?:della\s*)?fattura|fecha\s*(?:de\s*)?(?:la\s*)?(?:factura|emisi[óo]n)|fakturadatum|data\s*wystawienia)/i;

const NET_LABEL =
  /(excl|exkl|subtotal|sub-total|zwischensumme|subtotaal|netto|\bnet\b|\bht\b|imponibile|imponible|hors\s*taxe)/i;
const GROSS_LABEL =
  /(incl|inkl|\bttc\b|\bdue\b|gesamt|brutto|endbetrag|rechnungsbetrag|te\s*betalen|grand\s*total|amount\s*payable|to\s*pay|zu\s*zahlen|à\s*payer|a\s*pagar|da\s*pagare)/i;
const VAT_LABEL = /(\bvat\b|\bbtw\b|mwst|\bust\b|\btva\b|\biva\b|\bmoms\b|umsatzsteuer|mehrwertsteuer|\btax\b)/i;
const TOTAL_LABEL = /(\btotal\b|\btotaal\b|\btotale\b|importe\s*total|montant)/i;

const REVERSE_CHARGE =
  /(reverse[\s-]*charge|autoliquidation|steuerschuldnerschaft|btw\s*verlegd|verlegging|verlegd|inversione\s*contabile|inversi[óo]n\s*del\s*sujeto\s*pasivo|art\.?\s*196|article\s*196|artikel\s*196)/i;

// An amount with exactly two decimals (so "21%" or a quantity isn't one).
const AMOUNT_RE = /-?\d{1,3}(?:[.,'   ]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;

function amountsIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const after = line.slice((m.index ?? 0) + m[0].length).trimStart();
    if (after.startsWith("%")) continue; // a rate, not an amount
    const v = parseAmount(m[0]);
    if (v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// VAT numbers
// ---------------------------------------------------------------------------

// Where a VAT number could start. A lookahead (not a consuming match) so a word
// like "ATTENTION" can't swallow the "DE123..." right after it.
const VAT_START =
  /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)(?=[ .-]?[0-9A-Z])/g;

/** Every well-formed EU VAT number in the (upper-cased) text, normalised, in order. */
export function findVatNumbers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(VAT_START)) {
    const raw = normalizeVatNumber(text.slice(m.index, m.index + 26)) ?? "";
    const country = countryFromVatNumber(raw);
    if (!country) continue;
    // The slice runs into whatever follows ("DE123456789 RECHNUNG"); take the
    // longest prefix that is a valid number for the country.
    for (let len = Math.min(raw.length, 16); len >= 6; len--) {
      const candidate = raw.slice(0, len);
      if (vatNumberMatchesCountry(candidate, country)?.ok) {
        if (!found.includes(candidate)) found.push(candidate);
        break;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function valueAfterLabel(lines: string[], i: number, label: RegExp): string {
  const m = label.exec(lines[i]);
  const rest = m ? lines[i].slice(m.index + m[0].length) : lines[i];
  // Label at the end of a line: the value is usually on the next line.
  return rest.replace(/^[\s:#.°º-]+/, "").length > 0 ? rest : (lines[i + 1] ?? "");
}

function findInvoiceNumber(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!INVOICE_NUMBER_LABEL.test(lines[i])) continue;
    if (INVOICE_DATE_LABEL.test(lines[i]) && !/(no|nr|number|nummer|num|#)/i.test(lines[i])) continue;
    const rest = valueAfterLabel(lines, i, INVOICE_NUMBER_LABEL).replace(/^[\s:#.°º-]+/, "");
    const token = /^([A-Za-z0-9][A-Za-z0-9\-/._]{1,29})/.exec(rest)?.[1]?.replace(/[._-]+$/, "");
    if (token && /\d/.test(token) && !findDate(token)) return token;
  }
  return undefined;
}

function findInvoiceDate(lines: string[], fullText: string): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!INVOICE_DATE_LABEL.test(lines[i])) continue;
    const date = findDate(valueAfterLabel(lines, i, INVOICE_DATE_LABEL));
    if (date) return date;
  }
  return findDate(fullText);
}

function findCurrency(text: string): string | undefined {
  const counts: Record<string, number> = {};
  const add = (c: string, re: RegExp) => {
    const n = text.match(re)?.length ?? 0;
    if (n) counts[c] = (counts[c] ?? 0) + n;
  };
  add("EUR", /€|\bEUR\b/g);
  add("USD", /\$|\bUSD\b/g);
  add("GBP", /£|\bGBP\b/g);
  for (const c of ["CHF", "SEK", "DKK", "PLN", "CZK", "HUF", "RON"]) add(c, new RegExp(`\\b${c}\\b`, "g"));
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best?.[0];
}

export function parseInvoiceText(
  text: string,
  options: { ownVatNumbers?: string[] } = {},
): ParsedInvoiceText {
  const clean = text.replace(/ | /g, " ").replace(/\r/g, "");
  const lines = clean
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const result: ParsedInvoiceText = { reverseCharge: REVERSE_CHARGE.test(clean), found: [], confidence: 0 };

  result.invoiceNumber = findInvoiceNumber(lines);
  result.invoiceDate = findInvoiceDate(lines, clean);
  result.currency = findCurrency(clean);

  const own = new Set((options.ownVatNumbers ?? []).map((v) => normalizeVatNumber(v)).filter(Boolean));
  const supplierVat = findVatNumbers(clean.toUpperCase()).find((v) => !own.has(v));
  if (supplierVat) {
    result.supplierVatNumber = supplierVat;
    result.supplierCountry = countryFromVatNumber(supplierVat) ?? undefined;
  }

  // Amounts: classify labelled lines, then prefer a combination that adds up.
  const net: number[] = [];
  const vat: number[] = [];
  const gross: number[] = [];
  lines.forEach((line, i) => {
    let bucket: number[] | null = null;
    if (NET_LABEL.test(line)) bucket = net;
    else if (GROSS_LABEL.test(line)) bucket = gross;
    else if (VAT_LABEL.test(line)) bucket = vat;
    else if (TOTAL_LABEL.test(line)) bucket = gross;
    if (!bucket) return;
    let amounts = amountsIn(line);
    if (amounts.length === 0 && lines[i + 1]) amounts = amountsIn(lines[i + 1]);
    const last = amounts.at(-1);
    if (last != null) bucket.push(toCents(last)!);
  });

  let g = gross.length ? Math.max(...gross) : undefined;
  let n: number | undefined;
  let v: number | undefined;
  let consistent = false;
  if (g != null) {
    outer: for (const nc of [...net].reverse()) {
      for (const vc of [...vat].reverse().concat(0)) {
        if (nc + vc === g) {
          n = nc;
          v = vc;
          consistent = true;
          break outer;
        }
      }
    }
  }
  if (!consistent) {
    n = net.at(-1);
    v = vat.at(-1);
    if (g == null && n != null && v != null) g = n + v;
  }
  if (n == null && g != null && (vat.length === 0 || result.reverseCharge)) {
    // No VAT line (typical for reverse charge): net = gross.
    n = g;
    consistent = consistent || vat.length === 0;
  }
  if (n != null) result.netAmount = centsToAmount(n);
  if (v != null && v !== 0) result.vatAmount = centsToAmount(v);
  if (g != null) result.grossAmount = centsToAmount(g);

  const keys = [
    "invoiceNumber",
    "invoiceDate",
    "currency",
    "netAmount",
    "vatAmount",
    "grossAmount",
    "supplierVatNumber",
    "supplierCountry",
  ] as const;
  result.found = keys.filter((k) => result[k] != null);

  const score =
    (result.invoiceNumber ? 20 : 0) +
    (result.invoiceDate ? 20 : 0) +
    (result.grossAmount ? 25 : 0) +
    (result.netAmount ? 10 : 0) +
    (result.supplierVatNumber ? 10 : 0) +
    (consistent && result.grossAmount ? 15 : 0);
  result.confidence = Math.min(100, score);
  return result;
}
