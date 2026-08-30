/**
 * Import the product catalogue from a CSV export of products.xlsx.
 *
 * Usage:
 *   npx tsx scripts/import-products.ts path/to/products.csv
 *
 * In Excel/LibreOffice: "Save As" → CSV (UTF-8). Expected columns (header row,
 * case-insensitive; extra columns are ignored):
 *
 *   sku,name,basePrice,vatRate,filter,description,materials,sizes,styles,designs
 *
 * The option columns (materials/sizes/styles/designs) are semicolon-separated
 * lists. A value may carry a price delta with a colon, e.g.:
 *
 *   materials = "Leer;Metaal:2.00"   → "Leer" (+0) and "Metaal" (+2.00)
 *   designs   = "Hert;Leeuw"
 *
 * Re-running updates existing products (matched by sku) and their options.
 */
import { readFileSync } from "node:fs";
import { PrismaClient, type ProductOptionType } from "@prisma/client";

const prisma = new PrismaClient();

/** Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function parseOptions(
  raw: string | undefined,
  type: ProductOptionType,
): { type: ProductOptionType; value: string; priceDelta: string }[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, i) => {
      const [value, delta] = part.split(":");
      return {
        type,
        value: value.trim(),
        priceDelta: delta ? delta.trim() : "0.00",
        sortOrder: i,
      };
    });
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/import-products.ts <products.csv>");
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(file, "utf8"));
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    sku: col("sku"),
    name: col("name"),
    basePrice: col("baseprice"),
    vatRate: col("vatrate"),
    filter: col("filter"),
    description: col("description"),
    materials: col("materials"),
    sizes: col("sizes"),
    styles: col("styles"),
    designs: col("designs"),
  };
  if (idx.sku < 0 || idx.name < 0 || idx.basePrice < 0) {
    console.error("CSV must have at least 'sku', 'name' and 'basePrice' columns.");
    process.exit(1);
  }

  let created = 0;
  let updated = 0;

  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const sku = get(idx.sku);
    if (!sku) continue;

    const options = [
      ...parseOptions(get(idx.materials), "MATERIAL"),
      ...parseOptions(get(idx.sizes), "SIZE"),
      ...parseOptions(get(idx.styles), "STYLE"),
      ...parseOptions(get(idx.designs), "DESIGN"),
    ];

    const data = {
      name: get(idx.name),
      basePrice: get(idx.basePrice) || "0",
      vatRate: get(idx.vatRate) || "21",
      filter: get(idx.filter) || null,
      description: get(idx.description) || null,
    };

    const existing = await prisma.product.findUnique({ where: { sku } });
    if (existing) {
      await prisma.$transaction([
        prisma.product.update({ where: { sku }, data }),
        prisma.productOption.deleteMany({ where: { productId: existing.id } }),
        prisma.productOption.createMany({
          data: options.map((o) => ({ ...o, productId: existing.id })),
        }),
      ]);
      updated++;
    } else {
      await prisma.product.create({
        data: { sku, ...data, options: { create: options } },
      });
      created++;
    }
    console.log(`  ${sku} — ${data.name} (${options.length} opties)`);
  }

  console.log(`\n✅  Klaar: ${created} aangemaakt, ${updated} bijgewerkt.\n`);
}

main()
  .catch((err) => {
    console.error("Import mislukt:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
