CREATE TYPE "InventoryCategory" AS ENUM ('MEDICINE', 'SUPPLEMENT', 'VITAMIN', 'CONTROLLED_MEDICINE');

CREATE TYPE "InventoryStockAction" AS ENUM (
  'STOCK_ADDED',
  'STOCK_DEDUCTED',
  'PRESCRIPTION_DISPENSED',
  'INVENTORY_APPROVED',
  'INVENTORY_REJECTED',
  'ITEM_EDITED',
  'ITEM_DELETED',
  'ITEM_RESUBMITTED'
);

ALTER TABLE "Medicine"
ADD COLUMN "category" "InventoryCategory" NOT NULL DEFAULT 'MEDICINE',
ADD COLUMN "brand" TEXT,
ADD COLUMN "content" TEXT,
ADD COLUMN "packaging" TEXT,
ADD COLUMN "companyName" TEXT,
ADD COLUMN "availableForPrescription" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "InventoryStockLog" (
  "logId" SERIAL NOT NULL,
  "medicineId" INTEGER NOT NULL,
  "itemName" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "quantityChange" INTEGER NOT NULL,
  "actionType" "InventoryStockAction" NOT NULL,
  "performedById" INTEGER,
  "performedByUsername" TEXT,
  "relatedPrescriptionId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryStockLog_pkey" PRIMARY KEY ("logId")
);

CREATE INDEX "Medicine_category_idx" ON "Medicine"("category");
CREATE INDEX "Medicine_availableForPrescription_idx" ON "Medicine"("availableForPrescription");
CREATE INDEX "InventoryStockLog_medicineId_createdAt_idx" ON "InventoryStockLog"("medicineId", "createdAt");
CREATE INDEX "InventoryStockLog_actionType_idx" ON "InventoryStockLog"("actionType");
CREATE INDEX "InventoryStockLog_relatedPrescriptionId_idx" ON "InventoryStockLog"("relatedPrescriptionId");

ALTER TABLE "InventoryStockLog"
ADD CONSTRAINT "InventoryStockLog_medicineId_fkey"
FOREIGN KEY ("medicineId") REFERENCES "Medicine"("medicineId") ON DELETE CASCADE ON UPDATE CASCADE;
