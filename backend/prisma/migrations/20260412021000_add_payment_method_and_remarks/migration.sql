-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'ONLINE_TRANSFER', 'E_WALLET');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN "remarks" TEXT;
