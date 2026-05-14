import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

const resetSequences = async () => {
  const tables: Array<{ table: string; idColumn: string }> = [
    { table: 'Patient', idColumn: 'patientId' },
    { table: 'Medicine', idColumn: 'medicineId' },
    { table: 'InventoryStockLog', idColumn: 'logId' },
    { table: 'Prescription', idColumn: 'prescriptionId' },
    { table: 'Consultation', idColumn: 'consultationId' },
    { table: 'MedicalCertificate', idColumn: 'medicalCertificateId' },
    { table: 'Appointment', idColumn: 'appointmentId' },
    { table: 'PrescriptionMedicine', idColumn: 'pmId' },
    { table: 'Payment', idColumn: 'paymentId' },
    { table: 'PaymentMedicineItem', idColumn: 'itemId' },
    { table: 'Receipt', idColumn: 'receiptId' },
    { table: 'AuditLog', idColumn: 'logId' },
  ];

  for (const { table, idColumn } of tables) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', '${idColumn}'), 1, false)`,
    ).catch(() => undefined);
  }

  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"User"', 'userId'), COALESCE((SELECT MAX("userId") FROM "User"), 1), true)`,
  );
};

const main = async () => {
  const doctors = await prisma.user.findMany({
    where: { role: Role.DOCTOR },
    orderBy: { userId: 'asc' },
  });

  if (doctors.length === 0) {
    throw new Error('No doctor accounts found. Aborting reset so no doctor password is lost.');
  }

  const backupDir = path.resolve(__dirname, '..', 'backups');
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `doctor-users-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );

  await writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        doctors,
      },
      null,
      2,
    ),
    'utf8',
  );

  await prisma.$transaction(async (tx) => {
    await tx.receipt.deleteMany();
    await tx.paymentMedicineItem.deleteMany();
    await tx.payment.deleteMany();
    await tx.medicalCertificate.deleteMany();
    await tx.prescriptionMedicine.deleteMany();
    await tx.prescription.deleteMany();
    await tx.consultation.deleteMany();
    await tx.appointment.deleteMany();
    await tx.inventoryStockLog.deleteMany();
    await tx.medicine.deleteMany();
    await tx.patient.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.user.deleteMany({
      where: {
        role: {
          not: Role.DOCTOR,
        },
      },
    });
  });

  await resetSequences();

  const remaining = await prisma.user.findMany({
    orderBy: { userId: 'asc' },
    select: {
      userId: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  console.log(JSON.stringify({ backupPath, remainingUsers: remaining }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
