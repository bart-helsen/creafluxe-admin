-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purchasePrice" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "lifetimeHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "powerKw" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "maintenancePerYear" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "usageHoursPerYear" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Machine_active_idx" ON "Machine"("active");
