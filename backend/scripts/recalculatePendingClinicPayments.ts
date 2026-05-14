import { PrismaClient, PaymentStatus, PaymentType, PrescriptionStatus } from '@prisma/client';
import { CONSULTATION_FEE } from '../src/services/clinicPayment';

const prisma = new PrismaClient();

const main = async () => {
  const prescriptions = await prisma.prescription.findMany({
    where: {
      status: PrescriptionStatus.DISPENSED,
      consultationId: { not: null },
      consultation: {
        payment: {
          status: PaymentStatus.PENDING_PAYMENT,
        },
      },
    },
    include: {
      consultation: {
        include: {
          payment: true,
        },
      },
      items: {
        include: {
          medicine: {
            select: {
              price: true,
            },
          },
        },
      },
    },
  });

  let updated = 0;

  for (const prescription of prescriptions) {
    const payment = prescription.consultation?.payment;
    if (!payment) continue;

    const medicineItems = prescription.items.map((item) => {
      const unitPrice = Number(item.medicine.price);
      return {
        medicineId: item.medicineId,
        qty: item.qty,
        unitPrice,
        subtotal: unitPrice * item.qty,
      };
    });
    const medicineTotal = medicineItems.reduce((sum, item) => sum + item.subtotal, 0);

    await prisma.$transaction(async (tx) => {
      await tx.paymentMedicineItem.deleteMany({
        where: { paymentId: payment.paymentId },
      });
      await tx.payment.update({
        where: { paymentId: payment.paymentId },
        data: {
          type: PaymentType.CONSULTATION,
          amount: CONSULTATION_FEE + medicineTotal,
          prescriptionId: prescription.prescriptionId,
          appointmentId: prescription.appointmentId,
          remarks: 'Auto-recalculated from dispensed prescription',
          medicineItems: {
            create: medicineItems,
          },
        },
      });
    });

    updated += 1;
  }

  console.log(`Recalculated ${updated} pending clinic payment(s).`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
