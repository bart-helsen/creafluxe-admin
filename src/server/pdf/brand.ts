import path from "node:path";

// Shared Creafluxe brand pieces for generated PDFs (invoices, offers).
//
// Styling follows the Creafluxe brand design system: Manrope type,
// creafluxe-gray ink, one warm orange accent (never used for text except the
// key total figure), sharp corners and generous white space. Brand assets
// (logo + font files) live in public/pdf/ — see public/pdf/fonts/README.md
// for where they came from and how to regenerate them.

const EUR = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});
export const eur = (v: string | number) => EUR.format(Number(v));

// --- Brand tokens (creafluxe design system: tokens.json color.tokens) ------
export const COLOR = {
  gray: "#494949", // creafluxe-gray — primary ink (headings, body)
  orange: "#e5622e", // creafluxe-orange — graphic only: rules & accents, never text
  orangeText: "#c04818", // creafluxe-orange-text — the only orange for text/key figures
  surfaceAlt: "#f5f2ef", // warm off-white — table header band
  inkMuted: "#6b6b6b", // secondary text: addresses, meta, footnotes
} as const;

// Static weight instances of the brand's variable font
// (public/fonts/Manrope-Variable.woff2). pdfkit/fontkit can only embed a
// variable font at its single default (lightest) weight, so these were
// pre-generated once with fonttools — see public/pdf/fonts/README.md.
const PDF_ASSETS_DIR = path.join(process.cwd(), "public", "pdf");
const FONT_FILES = {
  light: "fonts/Manrope-Light.ttf",
  regular: "fonts/Manrope-Regular.ttf",
  medium: "fonts/Manrope-Medium.ttf",
  semibold: "fonts/Manrope-SemiBold.ttf",
  bold: "fonts/Manrope-Bold.ttf",
} as const;
export const LOGO_PATH = path.join(PDF_ASSETS_DIR, "creafluxe-logo.png");
export const LOGO_ASPECT = 900 / 386; // width / height of the source asset

export function registerBrandFonts(doc: PDFKit.PDFDocument) {
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    doc.registerFont(`Manrope-${weight}`, path.join(PDF_ASSETS_DIR, file));
  }
}

/** Small uppercase, letter-spaced label — the design system's "label" style. */
export function drawLabel(
  doc: PDFKit.PDFDocument,
  str: string,
  x: number,
  y: number,
  opts: PDFKit.Mixins.TextOptions & { color?: string } = {},
) {
  const { color, ...rest } = opts;
  doc
    .font("Manrope-semibold")
    .fontSize(9.5)
    .fillColor(color ?? COLOR.inkMuted)
    .text(str.toUpperCase(), x, y, { characterSpacing: 1.35, ...rest });
}
