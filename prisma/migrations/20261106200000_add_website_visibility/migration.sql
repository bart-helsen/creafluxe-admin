-- Publish material samples on the public website (additive only).
ALTER TABLE "Material" ADD COLUMN "showOnWebsite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publicName" TEXT,
ADD COLUMN "websiteText" TEXT;

ALTER TABLE "MaterialSampleGroup" ADD COLUMN "showOnWebsite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "websiteText" TEXT;
