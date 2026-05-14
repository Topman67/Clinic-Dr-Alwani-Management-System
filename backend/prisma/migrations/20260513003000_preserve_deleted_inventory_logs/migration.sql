ALTER TABLE "InventoryStockLog" DROP CONSTRAINT "InventoryStockLog_medicineId_fkey";

ALTER TABLE "InventoryStockLog" ALTER COLUMN "medicineId" DROP NOT NULL;

ALTER TABLE "InventoryStockLog"
ADD CONSTRAINT "InventoryStockLog_medicineId_fkey"
FOREIGN KEY ("medicineId") REFERENCES "Medicine"("medicineId") ON DELETE SET NULL ON UPDATE CASCADE;
