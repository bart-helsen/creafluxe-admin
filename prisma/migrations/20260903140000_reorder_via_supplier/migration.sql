-- Reorder source now lives on the supplier link, not on the material itself.
-- Add a per-supplier product page URL and drop the free-text reorder fields.
ALTER TABLE "SupplierMaterial" ADD COLUMN "productUrl" TEXT;
ALTER TABLE "Material" DROP COLUMN "reorderStore";
ALTER TABLE "Material" DROP COLUMN "reorderUrl";
