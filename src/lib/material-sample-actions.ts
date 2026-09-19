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

const OPERATIONS: Operation[] = ["RAW", "CUT", "ENGRAVE", "SCORE"];

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

  const storageKey = buildSampleKey(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  await putObject(storageKey, bytes, mimeType);

  await prisma.materialSample.create({
    data: {
      materialId,
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

  revalidatePath(`/materials/${materialId}`);
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

  await prisma.materialSample.update({
    where: { id },
    data: {
      caption: optStr(formData, "caption"),
      sortOrder: Number(str(formData, "sortOrder") || "0") || 0,
      active: formData.get("active") != null,
    },
  });

  revalidatePath(`/materials/${materialId}`);
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
  await prisma.materialSample.delete({ where: { id } });
  revalidatePath(`/materials/${materialId}`);
}
