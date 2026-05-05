-- CreateEnum
CREATE TYPE "MedicineApprovalStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN     "approvalStatus" "MedicineApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" INTEGER,
ADD COLUMN     "approvedByUsername" TEXT,
ADD COLUMN     "requestedById" INTEGER,
ADD COLUMN     "requestedByUsername" TEXT;
