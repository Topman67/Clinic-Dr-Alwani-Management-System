import {
  AppointmentStatus,
  ConsultationStatus,
  ConsultationType,
  PaymentStatus,
  PaymentType,
  PrescriptionStatus,
  Prisma,
} from '@prisma/client';

export const ALLOWED_CONSULTATION_FEES = [10, 15, 20, 25, 30] as const;
export const DEFAULT_CONSULTATION_FEE = 20;
export const APPOINTMENT_FEE = 5;
export const MEDICAL_CHECKUP_FEE = 40;

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
      consultationType: true,
      status: true,
      createdAt: true,
      doctor: {
        select: {
          userId: true,
          username: true,
        },
      },
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
          packaging: true,
          stockUnit: true,
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
  const consultationPaymentConditions = [
    refs.consultationId ? { consultationId: refs.consultationId } : null,
    refs.prescriptionId ? { prescriptionId: refs.prescriptionId } : null,
  ].filter(Boolean) as Prisma.PaymentWhereInput[];

  const conditions = consultationPaymentConditions.length > 0
    ? consultationPaymentConditions
    : (refs.appointmentId ? [{ appointmentId: refs.appointmentId }] : []);

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
  recordedByUsername?: string | null,
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
  const appointmentFee = prescription.appointmentId ? APPOINTMENT_FEE : 0;
  const totalAmount = DEFAULT_CONSULTATION_FEE + appointmentFee + medicineTotal;

  const existing = await findExistingClinicPayment(tx, {
    consultationId: prescription.consultationId,
    prescriptionId: prescription.prescriptionId,
  });
  if (existing) {
    if (existing.status !== PaymentStatus.PENDING_PAYMENT) {
      throw Object.assign(
        new Error('This consultation already has a confirmed payment. Prescription must be dispensed before payment is confirmed.'),
        { statusCode: 409 },
      );
    }

    await tx.paymentMedicineItem.deleteMany({
      where: { paymentId: existing.paymentId },
    });

    return tx.payment.update({
      where: { paymentId: existing.paymentId },
      data: {
        type: PaymentType.CONSULTATION,
        amount: totalAmount,
        consultationId: prescription.consultationId,
        prescriptionId: prescription.prescriptionId,
        appointmentId: prescription.appointmentId,
        status: PaymentStatus.PENDING_PAYMENT,
        dispensedAt: new Date(),
        dispensedById: recordedById,
        dispensedByUsername: recordedByUsername,
        remarks: 'Auto-updated after prescription dispense',
        medicineItems: {
          create: medicineItems,
        },
      },
      include: clinicPaymentInclude,
    });
  }

  const appointmentPayment = prescription.appointmentId
    ? await tx.payment.findUnique({
        where: { appointmentId: prescription.appointmentId },
        select: {
          paymentId: true,
          status: true,
          consultationId: true,
          prescriptionId: true,
        },
      })
    : null;

  if (
    appointmentPayment?.status === PaymentStatus.PENDING_PAYMENT &&
    !appointmentPayment.consultationId &&
    !appointmentPayment.prescriptionId
  ) {
    await tx.paymentMedicineItem.deleteMany({
      where: { paymentId: appointmentPayment.paymentId },
    });

    return tx.payment.update({
      where: { paymentId: appointmentPayment.paymentId },
      data: {
        type: PaymentType.CONSULTATION,
        amount: totalAmount,
        consultationId: prescription.consultationId,
        prescriptionId: prescription.prescriptionId,
        status: PaymentStatus.PENDING_PAYMENT,
        dispensedAt: new Date(),
        dispensedById: recordedById,
        dispensedByUsername: recordedByUsername,
        remarks: 'Auto-updated after prescription dispense',
        medicineItems: {
          create: medicineItems,
        },
      },
      include: clinicPaymentInclude,
    });
  }

  return tx.payment.create({
    data: {
      patientId: prescription.patientId,
      recordedById,
      type: PaymentType.CONSULTATION,
      amount: totalAmount,
      status: PaymentStatus.PENDING_PAYMENT,
      consultationId: prescription.consultationId,
      prescriptionId: prescription.prescriptionId,
      appointmentId: appointmentPayment ? undefined : prescription.appointmentId,
      dispensedAt: new Date(),
      dispensedById: recordedById,
      dispensedByUsername: recordedByUsername,
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

  if (!consultation) {
    throw Object.assign(new Error('Consultation not found.'), { statusCode: 404 });
  }
  if (consultation.status !== ConsultationStatus.COMPLETED) {
    throw Object.assign(new Error('Complete consultation before sending to payment.'), { statusCode: 400 });
  }
  if (consultation.prescription) {
    throw Object.assign(new Error('Prescription must be dispensed before payment.'), { statusCode: 400 });
  }
  if (consultation.consultationType === ConsultationType.MEDICAL_CHECKUP) {
    throw Object.assign(new Error('Use medical checkup send-to-payment for this consultation.'), { statusCode: 400 });
  }

  const existing = await findExistingClinicPayment(tx, {
    consultationId: consultation.consultationId,
  });
  if (existing) {
    if (existing.status === PaymentStatus.PAID) {
      throw Object.assign(new Error('This consultation has already been paid.'), { statusCode: 409 });
    }
    return existing;
  }

  const appointmentPayment = consultation.appointmentId
    ? await tx.payment.findUnique({
        where: { appointmentId: consultation.appointmentId },
        select: {
          paymentId: true,
          status: true,
          consultationId: true,
          prescriptionId: true,
        },
      })
    : null;

  if (
    appointmentPayment?.status === PaymentStatus.PENDING_PAYMENT &&
    !appointmentPayment.consultationId &&
    !appointmentPayment.prescriptionId
  ) {
    return tx.payment.update({
      where: { paymentId: appointmentPayment.paymentId },
      data: {
        type: PaymentType.CONSULTATION,
        amount: DEFAULT_CONSULTATION_FEE + (consultation.appointmentId ? APPOINTMENT_FEE : 0),
        consultationId: consultation.consultationId,
        status: PaymentStatus.PENDING_PAYMENT,
        remarks: 'Auto-created after consultation completion',
      },
      include: clinicPaymentInclude,
    });
  }

  return tx.payment.create({
    data: {
      patientId: consultation.patientId,
      recordedById,
      type: PaymentType.CONSULTATION,
      amount: DEFAULT_CONSULTATION_FEE + (consultation.appointmentId ? APPOINTMENT_FEE : 0),
      status: PaymentStatus.PENDING_PAYMENT,
      consultationId: consultation.consultationId,
      appointmentId: appointmentPayment ? undefined : consultation.appointmentId,
      remarks: 'Auto-created after consultation completion',
    },
    include: clinicPaymentInclude,
  });
};

export const createPendingPaymentForMedicalCheckup = async (
  tx: Prisma.TransactionClient,
  consultationId: number,
  recordedById: number,
) => {
  const consultation = await tx.consultation.findUnique({
    where: { consultationId },
    include: {
      prescription: { select: { prescriptionId: true } },
      payment: { select: { paymentId: true, status: true } },
    },
  });

  if (!consultation) {
    throw Object.assign(new Error('Consultation not found.'), { statusCode: 404 });
  }
  if (consultation.consultationType !== ConsultationType.MEDICAL_CHECKUP) {
    throw Object.assign(new Error('Only medical checkup consultations can be sent to payment here.'), { statusCode: 400 });
  }
  if (consultation.status !== ConsultationStatus.COMPLETED) {
    throw Object.assign(new Error('Complete medical checkup before sending to payment.'), { statusCode: 400 });
  }
  if (consultation.prescription) {
    throw Object.assign(new Error('This medical checkup has a prescription. Dispense prescription before payment.'), { statusCode: 400 });
  }
  if (consultation.payment) {
    if (consultation.payment.status === PaymentStatus.PAID) {
      throw Object.assign(new Error('This consultation has already been paid.'), { statusCode: 409 });
    }
    const existing = await tx.payment.findUnique({
      where: { paymentId: consultation.payment.paymentId },
      include: clinicPaymentInclude,
    });
    return existing;
  }

  return tx.payment.create({
    data: {
      patientId: consultation.patientId,
      recordedById,
      type: PaymentType.MEDICAL_CHECKUP,
      amount: MEDICAL_CHECKUP_FEE,
      status: PaymentStatus.PENDING_PAYMENT,
      consultationId: consultation.consultationId,
      remarks: 'Auto-created from medical checkup send to payment',
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
  if (APPOINTMENT_FEE <= 0) return null;

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
