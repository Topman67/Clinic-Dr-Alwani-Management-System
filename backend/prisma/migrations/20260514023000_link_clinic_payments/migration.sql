-- Add explicit clinic workflow payment links and a manual/custom payment type.
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'CUSTOM';

ALTER TABLE "Payment"
  ADD COLUMN "consultationId" INTEGER,
  ADD COLUMN "prescriptionId" INTEGER,
  ADD COLUMN "appointmentId" INTEGER;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_consultationId_fkey"
  FOREIGN KEY ("consultationId") REFERENCES "Consultation"("consultationId")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("prescriptionId")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("appointmentId")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Payment_consultationId_key" ON "Payment"("consultationId");
CREATE UNIQUE INDEX "Payment_prescriptionId_key" ON "Payment"("prescriptionId");
CREATE UNIQUE INDEX "Payment_appointmentId_key" ON "Payment"("appointmentId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_type_idx" ON "Payment"("type");
CREATE INDEX "Payment_date_idx" ON "Payment"("date");
