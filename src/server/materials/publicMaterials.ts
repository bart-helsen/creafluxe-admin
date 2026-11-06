import type { MaterialCategory, Operation } from "@prisma/client";
import { prisma } from "@/lib/db";

// The PUBLIC view of the material showcase, consumed by the website's
// "Materialen" section (GET /api/public/materials). Only what you switched on
// with "Toon op de website" is returned, and only active photos. Images are
// referenced by a stable path on this app (see the image route) instead of a
// presigned R2 URL, so they never expire and the bucket stays private.
//
// Publishing rules:
//   - a sample GROUP (e.g. "Berken multiplex") is published as ONE entry with
//     the group's photos, when the group is switched on;
//   - a material that is NOT in a group is published on its own with its own
//     photos, when it is switched on;
//   - an entry without any active photo is skipped.

export const PUBLIC_OPERATION_ORDER: Operation[] = [
  "RAW",
  "ENGRAVE_VECTOR",
  "ENGRAVE_BITMAP",
  "SCORE",
  "CUT",
];

export const PUBLIC_OPERATION_LABELS: Record<Operation, string> = {
  RAW: "Onbewerkt",
  ENGRAVE_VECTOR: "Vectorgravure",
  ENGRAVE_BITMAP: "Bitmapgravure",
  SCORE: "Gescoord",
  CUT: "Gesneden",
};

export const PUBLIC_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  WOOD: "Hout",
  PLASTIC: "Kunststof",
  METAL: "Metaal",
  PAPER: "Papier",
  GADGET: "Gadgets",
  CONSUMABLE: "Overig",
  OTHER: "Overig",
};

export interface PublicSample {
  id: string;
  caption: string | null;
  machine: string | null;
  /** Path on this app, e.g. /api/public/materials/image/<id>?v=<version> */
  image: string;
}

export interface PublicOperation {
  operation: Operation;
  label: string;
  samples: PublicSample[];
}

export interface PublicMaterial {
  slug: string;
  name: string;
  category: MaterialCategory;
  categoryLabel: string;
  text: string | null;
  operations: PublicOperation[];
}

export function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "materiaal"
  );
}

type SampleRow = {
  id: string;
  operation: Operation;
  caption: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  machine: { name: string } | null;
};

export function toOperations(rows: SampleRow[]): PublicOperation[] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const byOp = new Map<Operation, PublicSample[]>();
  for (const s of sorted) {
    const list = byOp.get(s.operation) ?? [];
    list.push({
      id: s.id,
      caption: s.caption,
      machine: s.machine?.name ?? null,
      image: `/api/public/materials/image/${s.id}?v=${s.updatedAt.getTime()}`,
    });
    byOp.set(s.operation, list);
  }
  return PUBLIC_OPERATION_ORDER.filter((op) => byOp.has(op)).map((op) => ({
    operation: op,
    label: PUBLIC_OPERATION_LABELS[op],
    samples: byOp.get(op)!,
  }));
}

const SAMPLE_SELECT = {
  id: true,
  operation: true,
  caption: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  machine: { select: { name: true } },
} as const;

export async function getPublicMaterials(): Promise<PublicMaterial[]> {
  const [groups, materials] = await Promise.all([
    prisma.materialSampleGroup.findMany({
      where: { showOnWebsite: true },
      orderBy: { name: "asc" },
      include: {
        samples: { where: { active: true }, select: SAMPLE_SELECT },
        materials: {
          where: { active: true },
          select: { category: true },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.material.findMany({
      where: { showOnWebsite: true, active: true, sampleGroupId: null },
      orderBy: { name: "asc" },
      include: { samples: { where: { active: true }, select: SAMPLE_SELECT } },
    }),
  ]);

  const out: PublicMaterial[] = [];
  const usedSlugs = new Set<string>();
  const uniqueSlug = (base: string) => {
    let slug = base;
    for (let i = 2; usedSlugs.has(slug); i++) slug = `${base}-${i}`;
    usedSlugs.add(slug);
    return slug;
  };

  for (const g of groups) {
    const operations = toOperations(g.samples);
    if (operations.length === 0) continue;
    const category = g.materials[0]?.category ?? "OTHER";
    out.push({
      slug: uniqueSlug(slugify(g.name)),
      name: g.name,
      category,
      categoryLabel: PUBLIC_CATEGORY_LABELS[category],
      text: g.websiteText,
      operations,
    });
  }

  for (const m of materials) {
    const operations = toOperations(m.samples);
    if (operations.length === 0) continue;
    const name = m.publicName?.trim() || m.name;
    out.push({
      slug: uniqueSlug(slugify(name)),
      name,
      category: m.category,
      categoryLabel: PUBLIC_CATEGORY_LABELS[m.category],
      text: m.websiteText,
      operations,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "nl"));
  return out;
}

/**
 * The sample, only when it may be shown publicly: active, and its material or
 * group is published. Null otherwise (the image route then answers 404).
 */
export async function findPublicSample(id: string) {
  const s = await prisma.materialSample.findUnique({
    where: { id },
    select: {
      storageKey: true,
      mimeType: true,
      active: true,
      group: { select: { showOnWebsite: true } },
      material: {
        select: { showOnWebsite: true, active: true, sampleGroupId: true },
      },
    },
  });
  if (!s || !s.active) return null;
  const published = s.group
    ? s.group.showOnWebsite
    : Boolean(
        s.material &&
          s.material.showOnWebsite &&
          s.material.active &&
          s.material.sampleGroupId === null,
      );
  return published ? { storageKey: s.storageKey, mimeType: s.mimeType } : null;
}
