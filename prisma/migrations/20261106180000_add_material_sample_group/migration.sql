-- CreateTable
CREATE TABLE "MaterialSampleGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialSampleGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSampleGroup_name_key" ON "MaterialSampleGroup"("name");

-- AlterTable
ALTER TABLE "Material" ADD COLUMN "sampleGroupId" TEXT;

-- AlterTable
ALTER TABLE "MaterialSample" ALTER COLUMN "materialId" DROP NOT NULL,
ADD COLUMN "groupId" TEXT;

-- A sample belongs to exactly one of: a material, or a sample group.
ALTER TABLE "MaterialSample" ADD CONSTRAINT "MaterialSample_owner_check"
    CHECK (("materialId" IS NOT NULL) <> ("groupId" IS NOT NULL));

-- CreateIndex
CREATE INDEX "Material_sampleGroupId_idx" ON "Material"("sampleGroupId");

-- CreateIndex
CREATE INDEX "MaterialSample_groupId_operation_idx" ON "MaterialSample"("groupId", "operation");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_sampleGroupId_fkey" FOREIGN KEY ("sampleGroupId") REFERENCES "MaterialSampleGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSample" ADD CONSTRAINT "MaterialSample_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MaterialSampleGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
