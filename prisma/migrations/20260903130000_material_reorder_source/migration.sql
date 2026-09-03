-- Materials: replace the physical storage location with a reorder source
-- (shop name + link to the product page you reorder from).
ALTER TABLE "Material" DROP COLUMN "storageLocation";
ALTER TABLE "Material" ADD COLUMN "reorderStore" TEXT;
ALTER TABLE "Material" ADD COLUMN "reorderUrl" TEXT;
