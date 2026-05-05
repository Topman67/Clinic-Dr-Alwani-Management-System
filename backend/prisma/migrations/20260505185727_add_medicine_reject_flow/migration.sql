-- AlterEnum
ALTER TYPE "MedicineApprovalStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" INTEGER,
ADD COLUMN     "rejectedByUsername" TEXT;
