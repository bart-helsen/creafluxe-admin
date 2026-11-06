"use server";

import { revalidatePath } from "next/cache";
import type { Operation } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isR2Configured,
  buildSampleKey,
  putObject,
  ALLOWED_SAMPLE_MIME,
  MAX_SAMPLE_BYTES,
} from "@/lib/r2";

// Server actions behind the material "showcase samples" section. Each re-checks
// the session (defence in depth on top of the middleware) and revalidates the
// material page so the UI reflects the change immediately. Uploads go straight
// to R2 through the server action (same pattern as uploadMasterAction); the DB
// row keeps only the storage key + metadata.

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length ? v : null;
}

const OPERATIONS: Operation[] = [
  "RAW",
  "CUT",
  "ENGRAVE_VECTOR",
  "ENGRAVE_BITMAP",
  "SCORE",
];

// ---------------------------------------------------------------------------
// Upload a showcase photo for a material (one operation, optionally a machine).
// ---------------------------------------------------------------------------
export async function uploadMaterialSampleAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();

  const materialId = str(formData, "materialId");
  const operation = str(formData, "operation") as Operation;
  const file = formData.get("file");
  // "group" = store on the material's sample group so every material in the
  // group shows it; anything else = only this material.
  const shareWithGroup = str(formData, "scope") === "group";

  if (!materialId) throw new Error("Onbekend materiaal.");
  if (!OPERATIONS.includes(operation)) {
    throw new Error("Kies een geldige bewerking.");
  }
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Kies een foto om te uploaden.");
  }

  // RAW = the untouched swatch, no machine. Every produced operation should say
  // which machine made it, so the same material on two machines is two rows.
  const machineId = operation === "RAW" ? null : optStr(formData, "machineId");
  if (operation !== "RAW" && !machineId) {
    throw new Error("Kies de machine waarmee dit staal gemaakt is.");
  }

  if (!isR2Configured()) {
    throw new Error(
      "Bestandsopslag (R2) is niet geconfigureerd — kan geen staal uploaden.",
    );
  }
  if (file.size > MAX_SAMPLE_BYTES) {
    throw new Error("Foto is groter dan 10 MB.");
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_SAMPLE_MIME.has(mimeType)) {
    throw new Error(`Bestandstype niet toegestaan: ${mimeType}. Gebruik JPG, PNG of WebP.`);
  }

  let groupId: string | null = null;
  if (shareWithGroup) {
    const m = await prisma.material.findUnique({
      where: { id: materialId },
      select: { sampleGroupId: true },
    });
    if (!m?.sampleGroupId) {
      throw new Error("Dit materiaal zit nog niet in een staalgroep.");
    }
    groupId = m.sampleGroupId;
  }

  const storageKey = buildSampleKey(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  await putObject(storageKey, bytes, mimeType);

  await prisma.materialSample.create({
    data: {
      // exactly one owner: the group (shared) or the material itself
      materialId: groupId ? null : materialId,
      groupId,
      operation,
      machineId,
      storageKey,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      caption: optStr(formData, "caption"),
      sortOrder: Number(str(formData, "sortOrder") || "0") || 0,
    },
  });

  revalidateSamples(materialId, groupId !== null);
}

// Group samples show on several material pages, so refresh them all.
function revalidateSamples(materialId: string, shared: boolean) {
  if (shared) revalidatePath("/materials", "layout");
  else revalidatePath(`/materials/${materialId}`);
}

// ---------------------------------------------------------------------------
// Edit an existing sample's caption / order / visibility (no re-upload).
// ---------------------------------------------------------------------------
export async function updateMaterialSampleAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const materialId = str(formData, "materialId");
  if (!id) throw new Error("Onbekend staal.");

  const updated = await prisma.materialSample.update({
    where: { id },
    data: {
      caption: optStr(formData, "caption"),
      sortOrder: Number(str(formData, "sortOrder") || "0") || 0,
      active: formData.get("active") != null,
    },
  });

  revalidateSamples(materialId, updated.groupId !== null);
}

// ---------------------------------------------------------------------------
// Delete a sample. We only remove the DB record; the R2 object can be
// garbage-collected later (same policy as deleteMasterAction).
// ---------------------------------------------------------------------------
export async function deleteMaterialSampleAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const materialId = str(formData, "materialId");
  const deleted = await prisma.materialSample.delete({ where: { id } });
  revalidateSamples(materialId, deleted.groupId !== null);
}

// ---------------------------------------------------------------------------
// Put a material in a sample group (pick an existing one or create a new one
// by name), or take it out again. Photos on the group are then shown on this
// material too; the material's own photos are untouched.
// ---------------------------------------------------------------------------
export async function setMaterialSampleGroupAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const materialId = str(formData, "materialId");
  if (!materialId) throw new Error("Onbekend materiaal.");

  const newName = str(formData, "newGroupName");
  const existingId = str(formData, "groupId");

  let sampleGroupId: string | null = null;
  if (newName) {
    const group = await prisma.materialSampleGroup.upsert({
      where: { name: newName },
      update: {},
      create: { name: newName },
    });
    sampleGroupId = group.id;
  } else if (existingId) {
    sampleGroupId = existingId;
  }

  await prisma.material.update({
    where: { id: materialId },
    data: { sampleGroupId },
  });

  revalidatePath("/materials", "layout");
}

// ---------------------------------------------------------------------------
// Publish the showcase on the public website ("Materialen" section).
// A material in a sample group is published through its GROUP (one entry for
// all thicknesses); a material without a group is published on its own.
// ---------------------------------------------------------------------------
export async function setMaterialWebsiteAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const materialId = str(formData, "materialId");
  if (!materialId) throw new Error("Onbekend materiaal.");

  const showOnWebsite = formData.get("showOnWebsite") === "on";
  const websiteText = optStr(formData, "websiteText");
  const publicName = optStr(formData, "publicName");

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { sampleGroupId: true },
  });
  if (!material) throw new Error("Materiaal niet gevonden.");

  if (material.sampleGroupId) {
    await prisma.materialSampleGroup.update({
      where: { id: material.sampleGroupId },
      data: { showOnWebsite, websiteText },
    });
  } else {
    await prisma.material.update({
      where: { id: materialId },
      data: { showOnWebsite, websiteText, publicName },
    });
  }

  revalidatePath("/materials", "layout");
}
