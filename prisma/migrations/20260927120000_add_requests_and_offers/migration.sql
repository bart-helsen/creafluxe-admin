-- Custom requests (Aanvragen) & offers (Offertes).
-- A custom job now starts as a QuoteRequest instead of an Order; an accepted
-- Offer turns it into a normal Order. Purely additive: no existing data changes.

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'WAITING_CUSTOMER', 'OFFER_SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestEventKind" AS ENUM ('CREATED', 'STATUS', 'NOTE', 'QUESTION', 'ANSWER', 'OFFER');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NEW_REQUEST';

-- AlterTable
ALTER TABLE "DesignAsset" ADD COLUMN "requestId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "offerLineId" TEXT;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN "requestId" TEXT;

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "channel" TEXT NOT NULL DEFAULT 'website',
    "clientRef" TEXT,
    "customerId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "customerRemarks" TEXT,
    "deliveryRequested" BOOLEAN NOT NULL DEFAULT false,
    "deliveryStreet" TEXT,
    "deliveryPostal" TEXT,
    "deliveryCity" TEXT,
    "deliveryCountry" TEXT,
    "deliveryNotes" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "RequestEventKind" NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus",
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "offerNumber" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "requestId" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "intro" TEXT,
    "terms" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "vatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "costTotal" DECIMAL(10,2),
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferLine" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 21.00,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "machineId" TEXT,
    "machineMinutes" DECIMAL(10,2),
    "labourHours" DECIMAL(10,2),
    "setupHours" DECIMAL(10,2),
    "unitCost" DECIMAL(10,2),
    "markupPercent" DECIMAL(5,2),

    CONSTRAINT "OfferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferLineMaterial" (
    "id" TEXT NOT NULL,
    "offerLineId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(10,4),

    CONSTRAINT "OfferLineMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_requestNumber_key" ON "QuoteRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_clientRef_key" ON "QuoteRequest"("clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_orderId_key" ON "QuoteRequest"("orderId");

-- CreateIndex
CREATE INDEX "QuoteRequest_status_idx" ON "QuoteRequest"("status");

-- CreateIndex
CREATE INDEX "QuoteRequest_createdAt_idx" ON "QuoteRequest"("createdAt");

-- CreateIndex
CREATE INDEX "QuoteRequest_customerId_idx" ON "QuoteRequest"("customerId");

-- CreateIndex
CREATE INDEX "RequestEvent_requestId_idx" ON "RequestEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_offerNumber_key" ON "Offer"("offerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_orderId_key" ON "Offer"("orderId");

-- CreateIndex
CREATE INDEX "Offer_requestId_idx" ON "Offer"("requestId");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE INDEX "OfferLine_offerId_idx" ON "OfferLine"("offerId");

-- CreateIndex
CREATE INDEX "OfferLine_machineId_idx" ON "OfferLine"("machineId");

-- CreateIndex
CREATE INDEX "OfferLineMaterial_offerLineId_idx" ON "OfferLineMaterial"("offerLineId");

-- CreateIndex
CREATE INDEX "OfferLineMaterial_materialId_idx" ON "OfferLineMaterial"("materialId");

-- CreateIndex
CREATE INDEX "DesignAsset_requestId_idx" ON "DesignAsset"("requestId");

-- AddForeignKey
ALTER TABLE "DesignAsset" ADD CONSTRAINT "DesignAsset_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_offerLineId_fkey" FOREIGN KEY ("offerLineId") REFERENCES "OfferLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLine" ADD CONSTRAINT "OfferLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLine" ADD CONSTRAINT "OfferLine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLineMaterial" ADD CONSTRAINT "OfferLineMaterial_offerLineId_fkey" FOREIGN KEY ("offerLineId") REFERENCES "OfferLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLineMaterial" ADD CONSTRAINT "OfferLineMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
