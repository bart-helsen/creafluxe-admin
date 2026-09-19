-- CreateEnum
CREATE TYPE "Operation" AS ENUM ('RAW', 'CUT', 'ENGRAVE', 'SCORE');

-- CreateTable
CREATE TABLE "MaterialSample" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "operation" "Operation" NOT NULL,
    "machineId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSample_storageKey_key" ON "MaterialSample"("storageKey");

-- CreateIndex
CREATE INDEX "MaterialSample_materialId_operation_idx" ON "MaterialSample"("materialId", "operation");

-- CreateIndex
CREATE INDEX "MaterialSample_machineId_idx" ON "MaterialSample"("machineId");

-- AddForeignKey
ALTER TABLE "MaterialSample" ADD CONSTRAINT "MaterialSample_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSample" ADD CONSTRAINT "MaterialSample_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
