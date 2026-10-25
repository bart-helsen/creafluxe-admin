import type {
  Prisma,
  PurchaseInvoiceSource,
  PurchaseInvoiceStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { PURCHASE_STATUS_LABELS, normalizeInvoiceNumber } from "@/lib/purchases";
import { buildPurchaseKey, putObject, isR2Configured } from "@/lib/r2";
import type { PurchaseSaveInput } from "@/lib/validation";
import { recordStockMovement } from "@/server/materials/stock";
import { extractFromFile, extractionJson } from "@/server/purchases/extract";

// The purchase-invoice workflow: receive (upload / e-mail), review & confirm,
// mark as uploaded to Dexxter. Every status change is written as a
// PurchaseInvoiceEvent — the same audit idea as orders and requests.

/** A problem the user should see (shown in the form), not a crash. */
export class PurchaseError extends Error {}

/** Allowed status moves. Confirming is always a deliberate action by you. */
const TRANSITIONS: Record<PurchaseInvoiceStatus, PurchaseInvoiceStatus[]> = {
  RECEIVED: ["CHECKED"],
  CHECKED: ["RECEIVED", "UPLOADED_TO_DEXXTER"],
  UPLOADED_TO_DEXXTER: ["CHECKED"],
};

export function canTransition(from: PurchaseInvoiceStatus, to: PurchaseInvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Fields that must be filled before an invoice can be confirmed (→ CHECKED). */
export function purchaseConfirmMissing(input: {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  netAmount?: string | null;
  grossAmount?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!input.supplierName) missing.push("leverancier");
  if (!input.invoiceNumber) missing.push("factuurnummer");
  if (!input.invoiceDate) missing.push("factuurdatum");
  if (!input.netAmount) missing.push("nettobedrag");
  if (!input.grossAmount) missing.push("brutobedrag");
  return missing;
}

/** Status timestamps that go with entering a status. */
function statusStamps(to: PurchaseInvoiceStatus, now: Date) {
  return {
    status: to,
    statusChangedAt: now,
    lastRemindedAt: null,
    ...(to === "CHECKED" ? { checkedAt: now } : {}),
    ...(to === "UPLOADED_TO_DEXXTER" ? { uploadedToDexxterAt: now } : {}),
    ...(to === "RECEIVED" ? { checkedAt: null } : {}),
  };
}

/** "2026-03-14" → a Date for a @db.Date column (UTC midnight). */
export function dateOnly(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

/** A @db.Date value back to "2026-03-14". */
export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------

export interface ReceiveFile {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Store a received invoice: file to R2 (when there is one), local text
 * prefill, and the CREATED event. Without a file (R2 not configured locally, or
 * "enter without file") you get an empty record to fill in by hand.
 */
export async function receivePurchaseInvoice(params: {
  file?: ReceiveFile | null;
  source: PurchaseInvoiceSource;
  sourceRef?: string | null;
  notes?: string | null;
  userId?: string | null;
}): Promise<{ id: string }> {
  const { file } = params;
  let fileData: { fileKey?: string; fileName?: string; mimeType?: string; sizeBytes?: number } = {};
  let extraction = null;

  if (file) {
    if (!isR2Configured()) {
      throw new PurchaseError("Bestandsopslag (R2) is niet geconfigureerd — kan het bestand niet bewaren.");
    }
    const fileKey = buildPurchaseKey(file.fileName);
    await putObject(fileKey, file.bytes, file.mimeType);
    fileData = {
      fileKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
    };
    extraction = await extractFromFile(file.bytes, file.mimeType);
  }

  const created = await prisma.purchaseInvoice.create({
    data: {
      ...fileData,
      source: params.source,
      sourceRef: params.sourceRef ?? undefined,
      notes: params.notes ?? undefined,
      extraction: extractionJson(extraction),
      extractionConfidence: extraction?.confidence,
      events: {
        create: {
          kind: "CREATED",
          toStatus: "RECEIVED",
          note:
            params.source === "EMAIL"
              ? "Ontvangen via e-mail"
              : file
                ? `Geüpload: ${file.fileName}`
                : "Handmatig aangemaakt (zonder bestand)",
          userId: params.userId ?? undefined,
        },
      },
    },
    select: { id: true },
  });
  return created;
}

// ---------------------------------------------------------------------------
// Review & confirm
// ---------------------------------------------------------------------------

/** Find the supplier by id, else by name (case-insensitive), else create it. */
async function resolveSupplier(
  tx: Prisma.TransactionClient,
  input: PurchaseSaveInput,
): Promise<string | null> {
  if (input.supplierId) {
    const s = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } });
    if (s) return s.id;
  }
  if (!input.supplierName) return null;
  const existing = await tx.supplier.findFirst({
    where: { name: { equals: input.supplierName, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.supplier.create({
    data: {
      name: input.supplierName,
      countryCode: input.supplierCountry,
      vatNumber: input.supplierVatNumber,
      addressCountry: null,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Save the review form. `confirm` moves a RECEIVED invoice to CHECKED (after
 * the minimum fields are present) and remembers this supplier's defaults. An
 * invoice already in Dexxter can't be edited — move it back first.
 */
export async function savePurchaseInvoice(params: {
  id: string;
  input: PurchaseSaveInput;
  confirm: boolean;
  userId?: string | null;
}): Promise<{ status: PurchaseInvoiceStatus }> {
  const { id, input, confirm } = params;
  const current = await prisma.purchaseInvoice.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) throw new PurchaseError("Inkoopfactuur niet gevonden.");
  if (current.status === "UPLOADED_TO_DEXXTER") {
    throw new PurchaseError(
      "Deze factuur staat al in Dexxter. Zet ze eerst terug naar ‘Klaar voor Dexxter’ om ze te wijzigen.",
    );
  }
  if (confirm) {
    const missing = purchaseConfirmMissing(input);
    if (missing.length) {
      throw new PurchaseError(`Vul eerst in om te bevestigen: ${missing.join(", ")}.`);
    }
  }

  const toStatus: PurchaseInvoiceStatus =
    confirm && current.status === "RECEIVED" ? "CHECKED" : current.status;
  const now = new Date();
  const dec = (v: string | null) => (v == null ? null : toDecimal(v));

  await prisma.$transaction(async (tx) => {
    const supplierId = await resolveSupplier(tx, input);
    await tx.purchaseInvoice.update({
      where: { id },
      data: {
        supplierId,
        supplierName: input.supplierName,
        supplierCountry: input.supplierCountry,
        supplierVatNumber: input.supplierVatNumber,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: dateOnly(input.invoiceDate),
        currency: input.currency,
        netAmount: dec(input.netAmount),
        vatAmount: dec(input.vatAmount),
        grossAmount: dec(input.grossAmount),
        amountEur: input.currency === "EUR" ? null : dec(input.amountEur),
        vatTreatment: input.vatTreatment,
        category: input.category,
        notes: input.notes,
        ...(toStatus !== current.status ? statusStamps(toStatus, now) : {}),
      },
    });
    await tx.purchaseInvoiceEvent.create({
      data: {
        purchaseInvoiceId: id,
        kind: toStatus !== current.status ? "STATUS" : "UPDATED",
        fromStatus: toStatus !== current.status ? current.status : undefined,
        toStatus: toStatus !== current.status ? toStatus : undefined,
        note: toStatus !== current.status ? "Gegevens gecontroleerd en bevestigd" : "Gegevens bijgewerkt",
        userId: params.userId ?? undefined,
      },
    });
    // Confirmed data becomes this supplier's defaults for next time.
    if (confirm && supplierId) {
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          ...(input.supplierVatNumber ? { vatNumber: input.supplierVatNumber } : {}),
          ...(input.supplierCountry ? { countryCode: input.supplierCountry } : {}),
          defaultCurrency: input.currency,
          defaultCategory: input.category,
          defaultVatTreatment: input.vatTreatment,
        },
      });
    }
  });

  return { status: toStatus };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function changePurchaseStatus(params: {
  id: string;
  toStatus: PurchaseInvoiceStatus;
  note?: string | null;
  userId?: string | null;
}): Promise<void> {
  const current = await prisma.purchaseInvoice.findUnique({
    where: { id: params.id },
    select: { status: true, supplierName: true, invoiceNumber: true, invoiceDate: true, netAmount: true, grossAmount: true },
  });
  if (!current) throw new PurchaseError("Inkoopfactuur niet gevonden.");
  if (current.status === params.toStatus) return;
  if (!canTransition(current.status, params.toStatus)) {
    throw new PurchaseError(
      `Kan niet van ‘${PURCHASE_STATUS_LABELS[current.status]}’ naar ‘${PURCHASE_STATUS_LABELS[params.toStatus]}’.`,
    );
  }
  if (params.toStatus === "CHECKED" && current.status === "RECEIVED") {
    // Confirming goes through the review form (savePurchaseInvoice), never here.
    throw new PurchaseError("Bevestig de gegevens via het formulier.");
  }

  await prisma.$transaction([
    prisma.purchaseInvoice.update({
      where: { id: params.id },
      data: statusStamps(params.toStatus, new Date()),
    }),
    prisma.purchaseInvoiceEvent.create({
      data: {
        purchaseInvoiceId: params.id,
        kind: "STATUS",
        fromStatus: current.status,
        toStatus: params.toStatus,
        note: params.note ?? undefined,
        userId: params.userId ?? undefined,
      },
    }),
  ]);
}

/**
 * Bulk "uploaded to Dexxter" after downloading the pack. Only the given ids
 * that are still CHECKED move — so an invoice confirmed after you downloaded
 * the pack is never marked by accident. Returns how many moved.
 */
export async function markUploadedToDexxter(ids: string[], userId?: string | null): Promise<number> {
  if (ids.length === 0) return 0;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const ready = await tx.purchaseInvoice.findMany({
      where: { id: { in: ids }, status: "CHECKED" },
      select: { id: true },
    });
    const readyIds = ready.map((r) => r.id);
    if (readyIds.length === 0) return 0;
    await tx.purchaseInvoice.updateMany({
      where: { id: { in: readyIds } },
      data: statusStamps("UPLOADED_TO_DEXXTER", now),
    });
    await tx.purchaseInvoiceEvent.createMany({
      data: readyIds.map((purchaseInvoiceId) => ({
        purchaseInvoiceId,
        kind: "STATUS" as const,
        fromStatus: "CHECKED" as const,
        toStatus: "UPLOADED_TO_DEXXTER" as const,
        note: "Gemarkeerd als geüpload (Dexxter-pakket)",
        userId: userId ?? undefined,
      })),
    });
    return readyIds.length;
  });
}

/** Remove a wrongly received invoice (duplicate upload, spam mail). RECEIVED only. */
export async function deletePurchaseInvoice(id: string): Promise<void> {
  const res = await prisma.purchaseInvoice.deleteMany({ where: { id, status: "RECEIVED" } });
  if (res.count === 0) {
    throw new PurchaseError("Alleen een factuur die nog ‘Te controleren’ is, kan verwijderd worden.");
  }
  // The R2 object is left in place, the same approach as the other file deletes.
}

// ---------------------------------------------------------------------------
// Duplicates & stock
// ---------------------------------------------------------------------------

/** Other invoices with the same supplier + invoice number (for the flag). */
export async function findDuplicateIds(params: {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
}): Promise<string[]> {
  const number = normalizeInvoiceNumber(params.invoiceNumber);
  if (!number) return [];
  const candidates = await prisma.purchaseInvoice.findMany({
    where: {
      id: { not: params.id },
      invoiceNumber: { not: null },
      OR: [
        ...(params.supplierId ? [{ supplierId: params.supplierId }] : []),
        ...(params.supplierName
          ? [{ supplierName: { equals: params.supplierName, mode: "insensitive" as const } }]
          : []),
      ],
    },
    select: { id: true, invoiceNumber: true },
  });
  return candidates
    .filter((c) => normalizeInvoiceNumber(c.invoiceNumber) === number)
    .map((c) => c.id);
}

/** Book material bought on this invoice into stock (optional link). */
export async function bookPurchaseStock(params: {
  purchaseInvoiceId: string;
  materialId: string;
  quantity: string;
  unitCost: string | null;
  userId?: string | null;
}): Promise<void> {
  const inv = await prisma.purchaseInvoice.findUnique({
    where: { id: params.purchaseInvoiceId },
    select: { supplierId: true, supplierName: true, invoiceNumber: true },
  });
  if (!inv) throw new PurchaseError("Inkoopfactuur niet gevonden.");
  await recordStockMovement({
    materialId: params.materialId,
    type: "PURCHASE",
    quantity: params.quantity,
    unitCost: params.unitCost,
    supplierId: inv.supplierId,
    purchaseInvoiceId: params.purchaseInvoiceId,
    reason: `Inkoopfactuur ${[inv.supplierName, inv.invoiceNumber].filter(Boolean).join(" ")}`.trim(),
    createdById: params.userId,
  });
}
