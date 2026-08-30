-- Idempotency key for order intake: a retried POST with the same clientRef
-- returns the first order instead of creating a duplicate.
ALTER TABLE "Order" ADD COLUMN "clientRef" TEXT;

CREATE UNIQUE INDEX "Order_clientRef_key" ON "Order"("clientRef");
