import { describe, expect, it } from "vitest";
import { describeConfiguration, productConfigurationSchema } from "./product-config";
import { intakeSchema } from "./validation";
import { intakeDescription } from "@/server/requests/createRequest";

// The website configurator posts these; the generator reads the same JSON, so
// anything that would make the generator fail must be refused here.

const box = (o: Record<string, unknown> = {}) => ({
  product: "memory-box",
  version: 1,
  quantity: 1,
  options: {
    lid: "lift",
    lidSide: null,
    inner: { w: 220, d: 160, h: 100 },
    dividers: [0.5],
    dividersY: [],
    feet: "arch",
    border: "vine",
    ornament: "heart",
    name: "Emma",
    date: "12 · 05 · 2024",
    photoWindow: null,
    artwork: null,
    artworkMode: null,
    ...o,
  },
});

describe("memory box configuration", () => {
  it("accepts a normal box", () => {
    expect(productConfigurationSchema.safeParse(box()).success).toBe(true);
  });

  it("refuses sizes outside what was tested in the generator", () => {
    expect(productConfigurationSchema.safeParse(box({ inner: { w: 400, d: 160, h: 100 } })).success).toBe(false);
  });

  it("refuses a photo window on another lid, with artwork, or too big", () => {
    const pw = { w: 140, h: 90 };
    expect(productConfigurationSchema.safeParse(box({ photoWindow: pw })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ lid: "hinge", photoWindow: pw })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ photoWindow: pw, artwork: "a.png" })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ photoWindow: { w: 215, h: 90 } })).success).toBe(false);
    // A 10 × 15 window on the small box would squeeze the name to ~4 mm.
    const small = { inner: { w: 180, d: 120, h: 70 } };
    expect(productConfigurationSchema.safeParse(box({ ...small, photoWindow: pw })).success).toBe(false);
  });

  it("refuses compartments that are too narrow", () => {
    expect(productConfigurationSchema.safeParse(box({ dividers: [0.25, 0.5, 0.75] })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ dividers: [0.5, 0.52] })).success).toBe(false);
  });

  it("accepts a side for the sliding lid and the hinge, but not for the lift lid", () => {
    expect(productConfigurationSchema.safeParse(box({ lid: "slide", lidSide: "left" })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ lid: "hinge", lidSide: "front" })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ lid: "slide", lidSide: null })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ lid: "slide", lidSide: undefined })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ lid: "lift", lidSide: "left" })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ lid: "slide", lidSide: "top" })).success).toBe(false);
  });

  it("takes the liners of a sliding lid off the direction it slides along", () => {
    // Open to the front or back: liners in the side walls, 6 mm off the width. Open left or right: 6 mm off the depth.
    // The last compartment is 18.6 mm without liners (accepted) and 17.7 mm with them (refused, under 15 mm net).
    const wide = { inner: { w: 120, d: 160, h: 100 }, dividers: [0.845] };
    expect(productConfigurationSchema.safeParse(box({ ...wide, lid: "slide", lidSide: "left" })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ ...wide, lid: "slide", lidSide: "front" })).success).toBe(false);
    const deep = { inner: { w: 220, d: 120, h: 100 }, dividers: [], dividersY: [0.845] };
    expect(productConfigurationSchema.safeParse(box({ ...deep, lid: "slide", lidSide: "front" })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ ...deep, lid: "slide", lidSide: "left" })).success).toBe(false);
  });

  it("refuses unknown options", () => {
    expect(productConfigurationSchema.safeParse(box({ border: "skulls" })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ thickness: 4 })).success).toBe(false);
  });

  it("describes the choices in Dutch", () => {
    const rows = describeConfiguration(productConfigurationSchema.parse(box()));
    expect(rows).toContainEqual({ label: "Deksel", value: "Opliggend deksel" });
    const slide = describeConfiguration(productConfigurationSchema.parse(box({ lid: "slide", lidSide: "left" })));
    expect(slide).toContainEqual({ label: "Deksel", value: "Schuifdeksel (schuift open naar links)" });
    const hinge = describeConfiguration(productConfigurationSchema.parse(box({ lid: "hinge" })));
    expect(hinge).toContainEqual({ label: "Deksel", value: "Scharnierdeksel (scharnier aan de achterkant)" });
    expect(rows).toContainEqual({ label: "Vakken links-rechts", value: "2 vakken (tussenschot op 50%)" });
  });
});

describe("intake with a configuration", () => {
  const customer = { name: "Test", email: "test@example.com" };

  it("is a valid CUSTOM request without a brief, and lists the choices in the description", () => {
    const input = intakeSchema.parse({ type: "CUSTOM", customer, configuration: box() });
    expect(intakeDescription(input)).toContain("• Naam: Emma");
  });

  it("is refused on a WEBSHOP order", () => {
    const r = intakeSchema.safeParse({
      type: "WEBSHOP",
      customer,
      configuration: box(),
      items: [{ name: "Doos", unitPrice: "10.00", quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("artwork mode", () => {
  it("accepts vector or photo with artwork", () => {
    expect(productConfigurationSchema.safeParse(box({ artwork: "a.png", artworkMode: "photo" })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ artwork: "a.svg", artworkMode: "vector" })).success).toBe(true);
    expect(productConfigurationSchema.safeParse(box({ artwork: "a.png" })).success).toBe(true);
  });
  it("refuses a mode without artwork, an unknown mode and a photo svg", () => {
    expect(productConfigurationSchema.safeParse(box({ artworkMode: "photo" })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ artwork: "a.png", artworkMode: "grey" })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ artwork: "a.svg", artworkMode: "photo" })).success).toBe(false);
  });
  it("describes the mode", () => {
    const p = productConfigurationSchema.parse(box({ artwork: "a.png", artworkMode: "photo" }));
    expect(describeConfiguration(p).some((r) => r.label === "Graveren als" && r.value.startsWith("Foto"))).toBe(true);
  });
});
