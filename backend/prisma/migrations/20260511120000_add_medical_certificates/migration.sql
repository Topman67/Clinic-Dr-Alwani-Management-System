CREATE TYPE "MedicalCertificateStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

CREATE TABLE "MedicalCertificate" (
    "medicalCertificateId" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "consultationId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "returnToWorkDate" TIMESTAMP(3) NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "notes" TEXT,
    "status" "MedicalCertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalCertificate_pkey" PRIMARY KEY ("medicalCertificateId")
);

CREATE INDEX "MedicalCertificate_patientId_createdAt_idx" ON "MedicalCertificate"("patientId", "createdAt");
CREATE UNIQUE INDEX "MedicalCertificate_consultationId_key" ON "MedicalCertificate"("consultationId");
CREATE INDEX "MedicalCertificate_doctorId_idx" ON "MedicalCertificate"("doctorId");

ALTER TABLE "MedicalCertificate"
ADD CONSTRAINT "MedicalCertificate_patientId_fkey"
FOREIGN KEY ("patientId")
REFERENCES "Patient"("patientId")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "MedicalCertificate"
ADD CONSTRAINT "MedicalCertificate_consultationId_fkey"
FOREIGN KEY ("consultationId")
REFERENCES "Consultation"("consultationId")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "MedicalCertificate"
ADD CONSTRAINT "MedicalCertificate_doctorId_fkey"
FOREIGN KEY ("doctorId")
REFERENCES "User"("userId")
ON DELETE RESTRICT
ON UPDATE CASCADE;
