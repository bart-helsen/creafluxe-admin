-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('RECEIVED', 'CHECKED', 'UPLOADED_TO_DEXXTER');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceSource" AS ENUM ('UPLOAD', 'EMAIL');

-- CreateEnum
CREATE TYPE "PurchaseVatTreatment" AS ENUM ('EU_REVERSE_CHARGE', 'BELGIAN_VAT', 'NON_EU_IMPORT', 'NO_VAT_RECOVERABLE');

-- CreateEnum
CREATE TYPE "PurchaseCategory" AS ENUM ('MATERIALS', 'SOFTWARE', 'SHIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceEventKind" AS ENUM ('CREATED', 'UPDATED', 'STATUS');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PURCHASE_INVOICE_REMINDER';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "defaultCategory" "PurchaseCategory",
ADD COLUMN     "defaultCurrency" TEXT,
ADD COLUMN     "defaultVatTreatment" "PurchaseVatTreatment",
ADD COLUMN     "vatNumber" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "purchaseInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "source" "PurchaseInvoiceSource" NOT NULL DEFAULT 'UPLOAD',
    "sourceRef" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "supplierCountry" TEXT,
    "supplierVatNumber" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "netAmount" DECIMAL(10,2),
    "vatAmount" DECIMAL(10,2),
    "grossAmount" DECIMAL(10,2),
    "amountEur" DECIMAL(10,2),
    "vatTreatment" "PurchaseVatTreatment" NOT NULL DEFAULT 'EU_REVERSE_CHARGE',
    "category" "PurchaseCategory" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "extraction" JSONB,
    "extractionConfidence" INTEGER,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "uploadedToDexxterAt" TIMESTAMP(3),
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceEvent" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "kind" "PurchaseInvoiceEventKind" NOT NULL,
    "fromStatus" "PurchaseInvoiceStatus",
    "toStatus" "PurchaseInvoiceStatus",
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseInvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_fileKey_key" ON "PurchaseInvoice"("fileKey");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_status_idx" ON "PurchaseInvoice"("status");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_invoiceDate_idx" ON "PurchaseInvoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_supplierId_idx" ON "PurchaseInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_sourceRef_idx" ON "PurchaseInvoice"("sourceRef");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceEvent_purchaseInvoiceId_idx" ON "PurchaseInvoiceEvent"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "StockMovement_purchaseInvoiceId_idx" ON "StockMovement"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceEvent" ADD CONSTRAINT "PurchaseInvoiceEvent_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceEvent" ADD CONSTRAINT "PurchaseInvoiceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

