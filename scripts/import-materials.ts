/**
 * Import your raw-material list from a CSV export (Phase 2b, docs/11).
 *
 * Usage:
 *   npx tsx scripts/import-materials.ts path/to/materials.csv
 *
 * In Excel/LibreOffice: "Save As" → CSV (UTF-8). Expected columns (header row,
 * case-insensitive; extra columns are ignored):
 *
 *   sku,name,category,unit,unitCost,reorderLevel,reorderQuantity,stockQuantity,
 *   reorderStore,reorderUrl,description,notes
 *
 * - `category` is one of WOOD, PLASTIC, METAL, PAPER, GADGET, CONSUMABLE, OTHER
 *   (defaults to OTHER if blank/unknown).
 * - `stockQuantity` is optional. If given and non-zero on a NEW material, an
 *   opening ADJUSTMENT stock movement is written so the ledger matches the total.
 *
 * Re-running updates existing materials (matched by sku); it does NOT re-open
 * stock (so you can't double-count) — adjust stock afterwards via the app.
 */
import { readFileSync } from "node:fs";
import { PrismaClient, type MaterialCategory } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORIES = new Set<MaterialCategory>([
  "WOOD",
  "PLASTIC",
  "METAL",
  "PAPER",
  "GADGET",
  "CONSUMABLE",
  "OTHER",
]);

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

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/import-materials.ts <materials.csv>");
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
    category: col("category"),
    unit: col("unit"),
    unitCost: col("unitcost"),
    reorderLevel: col("reorderlevel"),
    reorderQuantity: col("reorderquantity"),
    stockQuantity: col("stockquantity"),
    reorderStore: col("reorderstore"),
    reorderUrl: col("reorderurl"),
    description: col("description"),
    notes: col("notes"),
  };
  if (idx.sku < 0 || idx.name < 0) {
    console.error("CSV must have at least 'sku' and 'name' columns.");
    process.exit(1);
  }

  let created = 0;
  let updated = 0;

  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const sku = get(idx.sku);
    if (!sku) continue;

    const rawCat = get(idx.category).toUpperCase() as MaterialCategory;
    const category = CATEGORIES.has(rawCat) ? rawCat : "OTHER";
    const data = {
      name: get(idx.name),
      category,
      unit: get(idx.unit) || "stuk",
      unitCost: get(idx.unitCost) || "0",
      reorderLevel: get(idx.reorderLevel) || "0",
      reorderQuantity: get(idx.reorderQuantity) || null,
      reorderStore: get(idx.reorderStore) || null,
      reorderUrl: get(idx.reorderUrl) || null,
      description: get(idx.description) || null,
      notes: get(idx.notes) || null,
    };

    const existing = await prisma.material.findUnique({ where: { sku } });
    if (existing) {
      await prisma.material.update({ where: { sku }, data });
      updated++;
    } else {
      const opening = get(idx.stockQuantity);
      const openingQty = opening ? Number(opening) : 0;
      const material = await prisma.material.create({ data: { sku, ...data } });
      if (openingQty !== 0) {
        // Write the opening balance as an ADJUSTMENT so the ledger is honest.
        await prisma.$transaction([
          prisma.stockMovement.create({
            data: {
              materialId: material.id,
              type: "ADJUSTMENT",
              quantity: opening,
              reason: "Beginvoorraad (import)",
            },
          }),
          prisma.material.update({
            where: { id: material.id },
            data: { stockQuantity: opening },
          }),
        ]);
      }
      created++;
    }
    console.log(`  ${sku} — ${data.name}`);
  }

  console.log(`\n✅  Klaar: ${created} aangemaakt, ${updated} bijgewerkt.\n`);
}

main()
  .catch((err) => {
    console.error("Import mislukt:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
