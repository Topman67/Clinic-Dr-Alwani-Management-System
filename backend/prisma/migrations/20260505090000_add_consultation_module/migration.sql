-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN "consultationId" INTEGER;

-- CreateTable
CREATE TABLE "Consultation" (
    "consultationId" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "appointmentId" INTEGER,
    "doctorId" INTEGER NOT NULL DEFAULT 1,
    "symptoms" TEXT,
    "diagnosis" TEXT,
    "consultationNotes" TEXT,
    "temperature" TEXT,
    "bloodPressure" TEXT,
    "weight" TEXT,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("consultationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_consultationId_key" ON "Prescription"("consultationId");

-- CreateIndex
CREATE INDEX "Consultation_patientId_idx" ON "Consultation"("patientId");

-- CreateIndex
CREATE INDEX "Consultation_appointmentId_idx" ON "Consultation"("appointmentId");

-- CreateIndex
CREATE INDEX "Consultation_doctorId_status_idx" ON "Consultation"("doctorId", "status");

-- CreateIndex
CREATE INDEX "Consultation_createdAt_idx" ON "Consultation"("createdAt");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("consultationId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("patientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("appointmentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
