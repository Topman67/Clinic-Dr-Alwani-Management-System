CREATE TYPE "StockUnit" AS ENUM ('tablet', 'capsule', 'bottle', 'tube', 'sachet', 'pack', 'box');

ALTER TABLE "Medicine"
ADD COLUMN "stockUnit" "StockUnit" NOT NULL DEFAULT 'tablet';
