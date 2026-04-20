-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'MEDICINE';

-- CreateTable
CREATE TABLE "PaymentMedicineItem" (
    "itemId" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "medicineId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PaymentMedicineItem_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "PaymentMedicineItem_paymentId_idx" ON "PaymentMedicineItem"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentMedicineItem_medicineId_idx" ON "PaymentMedicineItem"("medicineId");

-- AddForeignKey
ALTER TABLE "PaymentMedicineItem" ADD CONSTRAINT "PaymentMedicineItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("paymentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMedicineItem" ADD CONSTRAINT "PaymentMedicineItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("medicineId") ON DELETE RESTRICT ON UPDATE CASCADE;
