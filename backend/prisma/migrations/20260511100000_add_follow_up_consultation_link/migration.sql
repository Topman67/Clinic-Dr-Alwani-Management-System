-- Link follow-up appointments back to the consultation that requested them.
ALTER TABLE "Appointment" ADD COLUMN "followUpFromConsultationId" INTEGER;

CREATE INDEX "Appointment_followUpFromConsultationId_idx" ON "Appointment"("followUpFromConsultationId");

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_followUpFromConsultationId_fkey"
FOREIGN KEY ("followUpFromConsultationId")
REFERENCES "Consultation"("consultationId")
ON DELETE SET NULL
ON UPDATE CASCADE;
