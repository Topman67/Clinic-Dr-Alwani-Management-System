ALTER TABLE "Medicine"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedBy" TEXT;

CREATE INDEX "Medicine_isActive_idx" ON "Medicine"("isActive");
