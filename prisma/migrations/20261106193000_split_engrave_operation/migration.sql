-- Split ENGRAVE into vector and bitmap engraving.
-- Existing ENGRAVE samples (if any) become vector engraving.
ALTER TYPE "Operation" RENAME VALUE 'ENGRAVE' TO 'ENGRAVE_VECTOR';
ALTER TYPE "Operation" ADD VALUE 'ENGRAVE_BITMAP';
