import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_NAMES = ['kamil', 'walkin customer', 'walk-in customer', 'test walkin'];
const TARGET_ICS = ['WALKIN-CUSTOMER'];

async function main() {
  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        ...TARGET_NAMES.map((name) => ({
          name: { equals: name, mode: 'insensitive' as const },
        })),
        ...TARGET_ICS.map((ic) => ({
          icOrPassport: { equals: ic, mode: 'insensitive' as const },
        })),
      ],
    },
    select: {
      patientId: true,
      name: true,
      icOrPassport: true,
    },
  });

  if (patients.length === 0) {
    console.log('No matching patients found.');
    return;
  }

  const patientIds = patients.map((p) => p.patientId);

  const prescriptions = await prisma.prescription.findMany({
    where: { patientId: { in: patientIds } },
    select: { prescriptionId: true },
  });
  const prescriptionIds = prescriptions.map((p) => p.prescriptionId);

  const payments = await prisma.payment.findMany({
    where: { patientId: { in: patientIds } },
    select: { paymentId: true },
  });
  const paymentIds = payments.map((p) => p.paymentId);

  const result = await prisma.$transaction(async (tx) => {
    const deletedPrescriptionItems =
      prescriptionIds.length > 0
        ? await tx.prescriptionMedicine.deleteMany({
            where: { prescriptionId: { in: prescriptionIds } },
          })
        : { count: 0 };

    const deletedPrescriptions = await tx.prescription.deleteMany({
      where: { patientId: { in: patientIds } },
    });

    const deletedPaymentItems =
      paymentIds.length > 0
        ? await tx.paymentMedicineItem.deleteMany({
            where: { paymentId: { in: paymentIds } },
          })
        : { count: 0 };

    const deletedReceipts =
      paymentIds.length > 0
        ? await tx.receipt.deleteMany({
            where: { paymentId: { in: paymentIds } },
          })
        : { count: 0 };

    const deletedPayments = await tx.payment.deleteMany({
      where: { patientId: { in: patientIds } },
    });

    const deletedPatients = await tx.patient.deleteMany({
      where: { patientId: { in: patientIds } },
    });

    return {
      deletedPrescriptionItems: deletedPrescriptionItems.count,
      deletedPrescriptions: deletedPrescriptions.count,
      deletedPaymentItems: deletedPaymentItems.count,
      deletedReceipts: deletedReceipts.count,
      deletedPayments: deletedPayments.count,
      deletedPatients: deletedPatients.count,
    };
  });

  console.log('Deleted patient records:');
  patients.forEach((patient) => {
    console.log(`- #${patient.patientId} ${patient.name} (${patient.icOrPassport})`);
  });

  console.log('Deletion summary:', result);
}

main()
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
