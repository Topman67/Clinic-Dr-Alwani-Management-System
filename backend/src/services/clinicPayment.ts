import {
  AppointmentStatus,
  ConsultationStatus,
  PaymentStatus,
  PaymentType,
  PrescriptionStatus,
  Prisma,
} from '@prisma/client';

export const CONSULTATION_FEE = 50;
export const APPOINTMENT_FEE = 50;

export const clinicPaymentInclude = {
  patient: {
    select: {
      patientId: true,
      name: true,
      icOrPassport: true,
      phone: true,
      address: true,
    },
  },
  receipt: true,
  consultation: {
    select: {
      consultationId: true,
      appointmentId: true,
      status: true,
      createdAt: true,
    },
  },
  prescription: {
    select: {
      prescriptionId: true,
      status: true,
      date: true,
    },
  },
  appointment: {
    select: {
      appointmentId: true,
      status: true,
      type: true,
      dateTime: true,
    },
  },
  medicineItems: {
    include: {
      medicine: {
        select: {
          medicineId: true,
          name: true,
          batchNumber: true,
          quantity: true,
          expiryDate: true,
        },
      },
    },
  },
  recordedBy: {
    select: {
      userId: true,
      username: true,
      role: true,
    },
  },
} satisfies Prisma.PaymentInclude;

const findExistingClinicPayment = async (
  tx: Prisma.TransactionClient,
  refs: { consultationId?: number | null; prescriptionId?: number | null; appointmentId?: number | null },
) => {
  const conditions = [
    refs.consultationId ? { consultationId: refs.consultationId } : null,
    refs.prescriptionId ? { prescriptionId: refs.prescriptionId } : null,
    refs.appointmentId ? { appointmentId: refs.appointmentId } : null,
  ].filter(Boolean) as Prisma.PaymentWhereInput[];

  if (conditions.length === 0) return null;

  return tx.payment.findFirst({
    where: { OR: conditions },
    include: clinicPaymentInclude,
  });
};

export const createPendingPaymentForDispensedPrescription = async (
  tx: Prisma.TransactionClient,
  prescriptionId: number,
  recordedById: number,
) => {
  const prescription = await tx.prescription.findUnique({
    where: { prescriptionId },
    include: {
      consultation: true,
      appointment: true,
      items: {
        include: {
          medicine: {
            select: {
              medicineId: true,
              price: true,
            },
          },
        },
      },
    },
  });

  if (!prescription) return null;
  if (prescription.status !== PrescriptionStatus.DISPENSED) return null;
  if (prescription.consultation?.status !== ConsultationStatus.COMPLETED) return null;

  const existing = await findExistingClinicPayment(tx, {
    consultationId: prescription.consultationId,
    prescriptionId: prescription.prescriptionId,
    appointmentId: prescription.appointmentId,
  });
  if (existing) return existing;

  const medicineItems = prescription.items.map((item) => {
    const unitPrice = Number(item.medicine.price);
    const subtotal = unitPrice * item.qty;
    return {
      medicineId: item.medicineId,
      qty: item.qty,
      unitPrice,
      subtotal,
    };
  });
  const medicineTotal = medicineItems.reduce((sum, item) => sum + item.subtotal, 0);

  return tx.payment.create({
    data: {
      patientId: prescription.patientId,
      recordedById,
      type: PaymentType.CONSULTATION,
      amount: CONSULTATION_FEE + medicineTotal,
      status: PaymentStatus.PENDING_PAYMENT,
      consultationId: prescription.consultationId,
      prescriptionId: prescription.prescriptionId,
      appointmentId: prescription.appointmentId,
      remarks: 'Auto-created after prescription dispense',
      medicineItems: {
        create: medicineItems,
      },
    },
    include: clinicPaymentInclude,
  });
};

export const createPendingPaymentForCompletedConsultationWithoutPrescription = async (
  tx: Prisma.TransactionClient,
  consultationId: number,
  recordedById: number,
) => {
  const consultation = await tx.consultation.findUnique({
    where: { consultationId },
    include: {
      prescription: { select: { prescriptionId: true } },
      appointment: { select: { appointmentId: true } },
    },
  });

  if (!consultation) return null;
  if (consultation.status !== ConsultationStatus.COMPLETED) return null;
  if (consultation.prescription) return null;

  const existing = await findExistingClinicPayment(tx, {
    consultationId: consultation.consultationId,
    appointmentId: consultation.appointmentId,
  });
  if (existing) return existing;

  return tx.payment.create({
    data: {
      patientId: consultation.patientId,
      recordedById,
      type: PaymentType.CONSULTATION,
      amount: CONSULTATION_FEE,
      status: PaymentStatus.PENDING_PAYMENT,
      consultationId: consultation.consultationId,
      appointmentId: consultation.appointmentId,
      remarks: 'Auto-created after consultation completion',
    },
    include: clinicPaymentInclude,
  });
};

export const createPendingPaymentForCompletedAppointment = async (
  tx: Prisma.TransactionClient,
  appointmentId: number,
  recordedById: number,
) => {
  const appointment = await tx.appointment.findUnique({
    where: { appointmentId },
    include: {
      consultations: { select: { consultationId: true } },
      prescriptions: { select: { prescriptionId: true } },
    },
  });

  if (!appointment) return null;
  if (appointment.status !== AppointmentStatus.COMPLETED) return null;
  if (appointment.consultations.length > 0 || appointment.prescriptions.length > 0) return null;

  const existing = await findExistingClinicPayment(tx, { appointmentId: appointment.appointmentId });
  if (existing) return existing;

  return tx.payment.create({
    data: {
      patientId: appointment.patientId,
      recordedById,
      type: PaymentType.APPOINTMENT,
      amount: APPOINTMENT_FEE,
      status: PaymentStatus.PENDING_PAYMENT,
      appointmentId: appointment.appointmentId,
      remarks: 'Auto-created after appointment completion',
    },
    include: clinicPaymentInclude,
  });
};
