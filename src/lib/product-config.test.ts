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

  it("refuses unknown options", () => {
    expect(productConfigurationSchema.safeParse(box({ border: "skulls" })).success).toBe(false);
    expect(productConfigurationSchema.safeParse(box({ thickness: 4 })).success).toBe(false);
  });

  it("describes the choices in Dutch", () => {
    const rows = describeConfiguration(productConfigurationSchema.parse(box()));
    expect(rows).toContainEqual({ label: "Deksel", value: "Opliggend deksel" });
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
