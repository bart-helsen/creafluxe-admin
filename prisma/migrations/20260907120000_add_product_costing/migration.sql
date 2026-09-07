-- AlterTable: webshop visibility flag, decoupled from `active`.
ALTER TABLE "Product" ADD COLUMN "showOnWebshop" BOOLEAN NOT NULL DEFAULT false;

-- Preserve current behaviour: products that are already active stay visible on
-- the webshop. Only NEW products (including ones promoted from the cost
-- calculator, which set showOnWebshop = false explicitly) default to hidden.
UPDATE "Product" SET "showOnWebshop" = true WHERE "active" = true;

-- CreateTable
CREATE TABLE "ProductCosting" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "machineId" TEXT,
    "machineMinutes" DECIMAL(10,2),
    "labourHours" DECIMAL(10,2),
    "costAtPromotion" DECIMAL(10,2),
    "priceAtPromotion" DECIMAL(10,2),
    "markupPercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCosting_productId_key" ON "ProductCosting"("productId");

-- CreateIndex
CREATE INDEX "ProductCosting_machineId_idx" ON "ProductCosting"("machineId");

-- CreateIndex
CREATE INDEX "Product_showOnWebshop_idx" ON "Product"("showOnWebshop");

-- AddForeignKey
ALTER TABLE "ProductCosting" ADD CONSTRAINT "ProductCosting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCosting" ADD CONSTRAINT "ProductCosting_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
