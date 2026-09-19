import type { Operation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isR2Configured, presignDownload } from "@/lib/r2";

// Assemble a material's showcase samples for display, grouped by operation, with
// a short-lived presigned URL per photo. Mirrors gatherOrderDesigns: the DB
// holds only storage keys; the URL is signed on demand (when R2 is configured).
//
// These URLs expire (default 10 min), which is fine for the admin. For the
// PUBLIC website you don't want to presign on every page view — instead either
// serve the samples bucket through a Cloudflare public URL / CDN and store that
// base, or cache a batch of presigned URLs. See the note at the bottom.

export interface MaterialSampleView {
  id: string;
  operation: Operation;
  machineId: string | null;
  machineName: string | null;
  caption: string | null;
  active: boolean;
  fileName: string;
  storageKey: string;
  imageUrl: string | null; // null when R2 isn't configured
}

export interface MaterialSampleGroup {
  operation: Operation;
  samples: MaterialSampleView[];
}

const OPERATION_ORDER: Operation[] = ["RAW", "ENGRAVE", "SCORE", "CUT"];

export async function gatherMaterialSamples(
  materialId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<MaterialSampleGroup[]> {
  const rows = await prisma.materialSample.findMany({
    where: {
      materialId,
      ...(includeInactive ? {} : { active: true }),
    },
    include: { machine: { select: { id: true, name: true } } },
    orderBy: [{ operation: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const r2On = isR2Configured();

  const views: MaterialSampleView[] = await Promise.all(
    rows.map(async (s) => ({
      id: s.id,
      operation: s.operation,
      machineId: s.machineId,
      machineName: s.machine?.name ?? null,
      caption: s.caption,
      active: s.active,
      fileName: s.fileName,
      storageKey: s.storageKey,
      imageUrl: r2On ? await presignDownload(s.storageKey) : null,
    })),
  );

  // Group by operation in a sensible display order (raw first, cut last).
  const byOperation = new Map<Operation, MaterialSampleView[]>();
  for (const v of views) {
    const list = byOperation.get(v.operation) ?? [];
    list.push(v);
    byOperation.set(v.operation, list);
  }

  return OPERATION_ORDER.filter((op) => byOperation.has(op)).map((op) => ({
    operation: op,
    samples: byOperation.get(op)!,
  }));
}
