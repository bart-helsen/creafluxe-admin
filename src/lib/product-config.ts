import { z } from "zod";

// Product configurations from the website configurators. The customer picks
// every option on the site; the intake stores the result on the request as
// JSON, and you download it to feed the generator in product-tools/
// (`python generate.py --config aanvraag-0042.json`).
//
// The shape is a contract with three places — keep them in step:
//   - the configurator page on the website (assets/js/configurator-memory-box.js)
//   - the generator (product-tools/memory-box/generator/generate.py, apply_config)
//   - this schema
// `lidSide` (optional, added without a version bump: a box without it is the usual one) is the side a sliding
// lid opens to or the hinge sits on; the generator turns the whole box accordingly.
// `artworkMode` (optional, same rule) says how the customer's own picture is engraved: "vector" = solid shapes,
// "photo" = grey tones as fine dots. Only with `artwork`; an SVG can only be a drawing.
// Bump `version` when the meaning of a field changes.

export const MEMORY_BOX_LIMITS = {
  inner: { w: [120, 340], d: [100, 250], h: [50, 150] },
  maxDividers: 3, // per direction
  minCompartment: 15, // mm, same check as the generator
  // The inside must be this much bigger than the photo window, or the window runs
  // into the border and the name gets squeezed (the generator itself only needs 7).
  photoMargin: { w: 30, d: 63 },
  nameMax: 40,
  dateMax: 30,
} as const;

export const LID_LABELS = {
  lift: "Opliggend deksel",
  slide: "Schuifdeksel",
  hinge: "Scharnierdeksel",
} as const;
// Where a sliding lid opens to / where the hinge sits, seen from the front of the box (the side the name reads from).
// Only the sliding lid and the hinge have a side.
export const SIDES = ["front", "back", "left", "right"] as const;
export const SLIDE_SIDE_LABELS = {
  front: "de voorkant",
  back: "de achterkant",
  left: "links",
  right: "rechts",
} as const;
export const HINGE_SIDE_LABELS = {
  front: "de voorkant",
  back: "de achterkant",
  left: "de linkerkant",
  right: "de rechterkant",
} as const;
export const FEET_LABELS = { arch: "Pootjes", flat: "Vlakke onderkant" } as const;
export const BORDER_LABELS = {
  vine: "Rank",
  hearts: "Hartjes",
  stars: "Sterren",
  dots: "Stippen",
  scallop: "Golfrand",
  double: "Dubbele lijn",
  none: "Geen rand",
} as const;
export const ORNAMENT_LABELS = {
  heart: "Hart",
  hearts: "Hartjes",
  star: "Ster",
  none: "Geen",
} as const;

const keysOf = <T extends Record<string, string>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const fraction = z.number().gt(0).lt(1);
const L = MEMORY_BOX_LIMITS;

/** The side of the lid, with the usual side when none was chosen; null for the lift lid. */
export function lidSideOf(o: { lid: keyof typeof LID_LABELS; lidSide?: (typeof SIDES)[number] | null }) {
  if (o.lid === "lift") return null;
  return o.lidSide ?? (o.lid === "slide" ? "front" : "back");
}

const memoryBoxOptionsSchema = z
  .object({
    lid: z.enum(keysOf(LID_LABELS)),
    // slide: the side it opens to (default front); hinge: the side of the hinge (default back); lift: none
    lidSide: z.enum(SIDES).nullish(),
    inner: z.object({
      w: z.number().min(L.inner.w[0]).max(L.inner.w[1]),
      d: z.number().min(L.inner.d[0]).max(L.inner.d[1]),
      h: z.number().min(L.inner.h[0]).max(L.inner.h[1]),
    }),
    dividers: z.array(fraction).max(L.maxDividers).default([]),
    dividersY: z.array(fraction).max(L.maxDividers).default([]),
    feet: z.enum(keysOf(FEET_LABELS)),
    border: z.enum(keysOf(BORDER_LABELS)),
    ornament: z.enum(keysOf(ORNAMENT_LABELS)),
    name: z.string().trim().max(L.nameMax).default(""),
    date: z.string().trim().max(L.dateMax).default(""),
    photoWindow: z.object({ w: z.number().positive(), h: z.number().positive() }).nullish(),
    artwork: z.string().trim().min(1).max(200).nullish(),
    artworkMode: z.enum(["vector", "photo"]).nullish(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.photoWindow) {
      if (o.lid !== "lift") {
        ctx.addIssue({ code: "custom", path: ["photoWindow"], message: "A photo window needs the lift lid." });
      }
      if (o.artwork) {
        ctx.addIssue({ code: "custom", path: ["photoWindow"], message: "Choose a photo window or artwork, not both." });
      }
      if (o.photoWindow.w > o.inner.w - L.photoMargin.w || o.photoWindow.h > o.inner.d - L.photoMargin.d) {
        ctx.addIssue({ code: "custom", path: ["photoWindow"], message: "The photo window is too big for this box." });
      }
    }
    if (o.artworkMode && !o.artwork) {
      ctx.addIssue({ code: "custom", path: ["artworkMode"], message: "An engraving mode needs artwork." });
    }
    if (o.artworkMode === "photo" && o.artwork && /\.svgz?$/i.test(o.artwork)) {
      ctx.addIssue({ code: "custom", path: ["artworkMode"], message: "An SVG can only be engraved as a drawing." });
    }
    if (o.lid === "lift" && o.lidSide) {
      ctx.addIssue({ code: "custom", path: ["lidSide"], message: "The lift lid has no side." });
    }
    // A sliding lid needs liners inside the two walls next to the open side: the side walls (open to the
    // front or back, so the inside is 2 × 3 mm narrower) or the front and back walls (left or right, 2 × 3 mm less deep).
    const side = lidSideOf(o);
    const width = o.lid === "slide" && (side === "front" || side === "back") ? o.inner.w - 6 : o.inner.w;
    const depth = o.lid === "slide" && (side === "left" || side === "right") ? o.inner.d - 6 : o.inner.d;
    for (const [key, size] of [["dividers", width], ["dividersY", depth]] as const) {
      const edges = [0, ...[...o[key]].sort((a, b) => a - b).map((f) => f * size), size];
      for (let i = 1; i < edges.length; i++) {
        if (edges[i] - edges[i - 1] - 3 < L.minCompartment) {
          ctx.addIssue({ code: "custom", path: [key], message: "A compartment would be too narrow." });
          break;
        }
      }
    }
  });

export const memoryBoxConfigSchema = z
  .object({
    product: z.literal("memory-box"),
    version: z.literal(1),
    quantity: z.number().int().min(1).max(50).default(1),
    options: memoryBoxOptionsSchema,
  })
  .strict();

export const productConfigurationSchema = z.discriminatedUnion("product", [memoryBoxConfigSchema]);

export type ProductConfiguration = z.infer<typeof productConfigurationSchema>;

export const PRODUCT_LABELS: Record<ProductConfiguration["product"], string> = {
  "memory-box": "Herinneringsdoos",
};

/** Parse a stored configuration; null when it is missing or no longer matches the schema. */
export function readConfiguration(value: unknown): ProductConfiguration | null {
  const parsed = productConfigurationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function compartments(fractions: number[]): string {
  if (fractions.length === 0) return "geen";
  const pct = [...fractions].sort((a, b) => a - b).map((f) => `${Math.round(f * 100)}%`);
  return `${fractions.length + 1} vakken (tussenschot op ${pct.join(", ")})`;
}

/** " (schuift open naar links)" / " (scharnier aan de achterkant)"; empty for the lift lid. */
function lidSideText(o: ProductConfiguration["options"]): string {
  const side = lidSideOf(o);
  if (!side) return "";
  return o.lid === "slide"
    ? ` (schuift open naar ${SLIDE_SIDE_LABELS[side]})`
    : ` (scharnier aan ${HINGE_SIDE_LABELS[side]})`;
}

/** The configuration as label/value rows, for the admin page and the e-mails. */
export function describeConfiguration(config: ProductConfiguration): { label: string; value: string }[] {
  const o = config.options;
  const rows = [
    { label: "Product", value: PRODUCT_LABELS[config.product] },
    { label: "Aantal", value: String(config.quantity) },
    { label: "Binnenmaat", value: `${o.inner.w} × ${o.inner.d} × ${o.inner.h} mm (b × d × h)` },
    { label: "Deksel", value: LID_LABELS[o.lid] + lidSideText(o) },
    { label: "Vakken links-rechts", value: compartments(o.dividers) },
    { label: "Vakken voor-achter", value: compartments(o.dividersY) },
    { label: "Onderkant", value: FEET_LABELS[o.feet] },
    { label: "Rand", value: BORDER_LABELS[o.border] },
    { label: "Ornament", value: ORNAMENT_LABELS[o.ornament] },
    { label: "Naam", value: o.name || "—" },
    { label: "Datum", value: o.date || "—" },
  ];
  if (o.photoWindow) {
    rows.push({ label: "Fotovenster", value: `${o.photoWindow.w} × ${o.photoWindow.h} mm` });
  }
  if (o.artwork) {
    rows.push({ label: "Eigen tekening", value: `${o.artwork} (zit als bijlage in de e-mail)` });
    rows.push({ label: "Graveren als", value: o.artworkMode === "photo" ? "Foto (grijstinten)" : "Tekening" });
  }
  return rows;
}

/** File name for the download, e.g. "aanvraag-0042-memory-box.json". */
export function configurationFileName(requestNumber: number, config: ProductConfiguration): string {
  return `aanvraag-${String(requestNumber).padStart(4, "0")}-${config.product}.json`;
}
