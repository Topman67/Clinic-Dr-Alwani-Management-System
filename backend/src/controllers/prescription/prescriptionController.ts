import { Request, Response } from 'express';
import { AppointmentStatus, ConsultationStatus, InventoryStockAction, MedicineApprovalStatus, PaymentStatus, PrescriptionStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';
import { createInventoryLog } from '../medicine/medicineController';
import { createPendingPaymentForDispensedPrescription } from '../../services/clinicPayment';

const isNonEmptyText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const WALKIN_CUSTOMER_PREFIX = 'WALKIN-';

const createHttpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const toDateKey = (value: Date) => value.toISOString().slice(0, 10);

const isExpiredMedicine = (expiryDate: Date) => toDateKey(expiryDate) < toDateKey(new Date());

const toDateStart = (value: string | undefined) => {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toDateEnd = (value: string | undefined) => {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const normalizePrescriptionStatusFilter = (status: string | undefined) => {
  if (status === 'PENDING') return PrescriptionStatus.PENDING_VERIFICATION;
  return status && Object.values(PrescriptionStatus).includes(status as PrescriptionStatus)
    ? status as PrescriptionStatus
    : undefined;
};

const prescriptionInclude = {
  patient: true,
  consultation: true,
  doctor: {
    select: {
      userId: true,
      username: true,
      role: true,
    },
  },
  items: { include: { medicine: true } },
};

const isUniqueConsultationPrescriptionConflict = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.some((field) => String(field) === 'consultationId');
  }

  return typeof target === 'string' && target.includes('consultationId');
};

export const createPrescription = async (req: Request, res: Response) => {
  const { patientId, doctorId, consultationId, appointmentId, notes, items } = req.body as {
    patientId: number;
    doctorId: number;
    consultationId?: number;
    appointmentId?: number;
    notes?: string;
    items: { medicineId: number; dosage: string; frequency: string; duration: string; qty: number }[];
  };

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  const targetConsultationId = Number(consultationId);
  if (!Number.isInteger(targetConsultationId) || targetConsultationId <= 0) {
    return res.status(400).json({ message: 'Consultation reference is required.' });
  }

  if (appointmentId !== undefined && (!Number.isInteger(appointmentId) || appointmentId <= 0)) {
    return res.status(400).json({ message: 'Invalid appointment reference.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  const hasInvalidItem = items.some(
    (item) =>
      !Number.isInteger(item.medicineId) ||
      item.medicineId <= 0 ||
      !isNonEmptyText(item.dosage) ||
      !isNonEmptyText(item.frequency) ||
      !isNonEmptyText(item.duration) ||
      !Number.isInteger(item.qty) ||
      item.qty <= 0,
  );

  if (hasInvalidItem) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  const patient = await prisma.patient.findUnique({ where: { patientId } });
  if (!patient) {
    return res.status(404).json({ message: 'Patient record not found.' });
  }

  if (!patient.isActive) {
    return res.status(400).json({ message: 'Archived patients cannot be used for new prescriptions.' });
  }

  if (patient.icOrPassport?.toUpperCase().startsWith(WALKIN_CUSTOMER_PREFIX)) {
    return res.status(400).json({ message: 'Walk-in sales customers are not available in prescription module.' });
  }

  const doctor = await prisma.user.findUnique({ where: { userId: doctorId } });
  if (!doctor) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  try {
    const prescription = await prisma.$transaction(async (tx) => {
      const consultation = await tx.consultation.findUnique({
        where: { consultationId: targetConsultationId },
        include: { prescription: { select: { prescriptionId: true } } },
      });
      if (!consultation) {
        throw createHttpError(404, 'Consultation not found.');
      }

      if (consultation.patientId !== patientId) {
        throw createHttpError(400, 'Consultation does not match selected patient.');
      }

      if (consultation.appointmentId && appointmentId !== undefined && consultation.appointmentId !== appointmentId) {
        throw createHttpError(400, 'Consultation does not match selected appointment.');
      }

      if (consultation.status !== ConsultationStatus.COMPLETED) {
        throw createHttpError(400, 'Complete consultation before creating prescription.');
      }

      if (consultation.prescription) {
        throw createHttpError(409, 'This consultation already has a prescription.');
      }

      const existingPayment = await tx.payment.findFirst({
        where: {
          consultationId: targetConsultationId,
          status: { not: PaymentStatus.CANCELLED },
        },
        select: {
          paymentId: true,
          status: true,
          prescriptionId: true,
        },
      });

      if (existingPayment?.status === PaymentStatus.PAID) {
        throw createHttpError(409, 'This consultation has already been paid. Create prescription before confirming payment.');
      }

      const targetAppointmentId = appointmentId ?? consultation.appointmentId ?? undefined;

      if (targetAppointmentId !== undefined) {
        const appointment = await tx.appointment.findUnique({ where: { appointmentId: targetAppointmentId } });
        if (!appointment) {
          throw createHttpError(404, 'Appointment not found.');
        }

        if (appointment.patientId !== patientId) {
          throw createHttpError(400, 'Appointment does not match selected patient.');
        }

        if (appointment.status === AppointmentStatus.CANCELLED || appointment.status === AppointmentStatus.NO_SHOW) {
          throw createHttpError(400, 'Cannot create prescription for cancelled or no-show appointment.');
        }
      }

      const requestedTotals = new Map<number, number>();
      items.forEach((item) => {
        requestedTotals.set(item.medicineId, (requestedTotals.get(item.medicineId) ?? 0) + item.qty);
      });

      const medicineIds = [...requestedTotals.keys()];
      const medicines = await tx.medicine.findMany({
        where: { medicineId: { in: medicineIds } },
        select: {
          medicineId: true,
          name: true,
          quantity: true,
          stockUnit: true,
          expiryDate: true,
          approvalStatus: true,
          availableForPrescription: true,
        },
      });

      if (medicines.length !== medicineIds.length) {
        throw createHttpError(404, 'One or more medicines were not found.');
      }

      for (const medicine of medicines) {
        if (medicine.approvalStatus !== MedicineApprovalStatus.APPROVED) {
          throw createHttpError(400, `${medicine.name} is not approved for prescribing.`);
        }

        if (!medicine.availableForPrescription) {
          throw createHttpError(400, `${medicine.name} is not available for prescriptions.`);
        }

        if (isExpiredMedicine(medicine.expiryDate)) {
          throw createHttpError(400, `${medicine.name} is expired and cannot be prescribed.`);
        }
      }

      const created = await tx.prescription.create({
        data: {
          patientId,
          doctorId,
          consultationId: targetConsultationId,
          appointmentId: targetAppointmentId,
          status: PrescriptionStatus.PENDING_VERIFICATION,
          notes,
          items: {
            create: items.map((it) => ({ ...it })),
          },
        },
        include: prescriptionInclude,
      });

      if (targetAppointmentId !== undefined) {
        await tx.appointment.update({
          where: { appointmentId: targetAppointmentId },
          data: { status: AppointmentStatus.COMPLETED },
        });
      }

      if (existingPayment?.status === PaymentStatus.PENDING_PAYMENT && !existingPayment.prescriptionId) {
        await tx.paymentMedicineItem.deleteMany({
          where: { paymentId: existingPayment.paymentId },
        });
        await tx.payment.delete({
          where: { paymentId: existingPayment.paymentId },
        });
      }

      return created;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    res.status(201).json(prescription);
    try {
      await logActivity(req.user?.userId, `create_prescription:${prescription.prescriptionId}`);
    } catch (_) {}
  } catch (error: unknown) {
    const httpStatus = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (error instanceof Error && typeof httpStatus === 'number') {
      return res.status(httpStatus).json({ message: error.message });
    }
    if (isUniqueConsultationPrescriptionConflict(error)) {
      return res.status(409).json({ message: 'This consultation already has a prescription.' });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return res.status(409).json({ message: 'Prescription creation conflicted. Please retry.' });
    }
    throw error;
  }
};

export const listPrescriptions = async (req: Request, res: Response) => {
  const { patientId, dateFrom, dateTo, status } = req.query as { patientId?: string; dateFrom?: string; dateTo?: string; status?: string };
  const normalizedStatus = normalizePrescriptionStatusFilter(status);

  const prescriptions = await prisma.prescription.findMany({
    where: {
      patientId: patientId ? Number(patientId) : undefined,
      status: normalizedStatus,
      patient: {
        is: {
          icOrPassport: {
            not: {
              startsWith: WALKIN_CUSTOMER_PREFIX,
            },
          },
        },
      },
      date: {
        gte: toDateStart(dateFrom),
        lte: toDateEnd(dateTo),
      },
    },
    include: prescriptionInclude,
    orderBy: { date: 'desc' },
  });
  res.json(prescriptions);
};

export const getPrescription = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const prescription = await prisma.prescription.findFirst({
    where: {
      prescriptionId: id,
      patient: {
        is: {
          icOrPassport: {
            not: {
              startsWith: WALKIN_CUSTOMER_PREFIX,
            },
          },
        },
      },
    },
    include: prescriptionInclude,
  });
  if (!prescription) return res.status(404).json({ message: 'Not found' });
  res.json(prescription);
};

const validatePrescriptionInventory = async (
  tx: Prisma.TransactionClient,
  items: Array<{ medicineId: number; qty: number }>,
) => {
  const requestedTotals = new Map<number, number>();
  items.forEach((item) => {
    requestedTotals.set(item.medicineId, (requestedTotals.get(item.medicineId) ?? 0) + item.qty);
  });

  const medicines = await tx.medicine.findMany({
    where: { medicineId: { in: [...requestedTotals.keys()] } },
    select: {
      medicineId: true,
      name: true,
      quantity: true,
      stockUnit: true,
      expiryDate: true,
      approvalStatus: true,
      availableForPrescription: true,
      batchNumber: true,
    },
  });

  for (const [medicineId, requestedQty] of requestedTotals.entries()) {
    const medicine = medicines.find((item) => item.medicineId === medicineId);
    if (!medicine) {
      throw createHttpError(404, 'One or more medicines were not found.');
    }

    if (medicine.approvalStatus !== MedicineApprovalStatus.APPROVED) {
      throw createHttpError(400, `${medicine.name} is not approved for dispensing.`);
    }

    if (!medicine.availableForPrescription) {
      throw createHttpError(400, `${medicine.name} is not available for prescriptions.`);
    }

    if (isExpiredMedicine(medicine.expiryDate)) {
      throw createHttpError(400, 'Expired medicine cannot be dispensed.');
    }

    if (medicine.quantity < requestedQty) {
      throw createHttpError(400, `Insufficient stock for ${medicine.name}. Available: ${medicine.quantity} ${medicine.stockUnit}.`);
    }
  }

  return requestedTotals;
};

export const verifyPrescription = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid prescription reference.' });

  try {
    const prescription = await prisma.$transaction(async (tx) => {
      const existing = await tx.prescription.findUnique({
        where: { prescriptionId: id },
        include: { items: true },
      });

      if (!existing) throw createHttpError(404, 'Prescription not found.');
      if (existing.status === PrescriptionStatus.REJECTED) throw createHttpError(400, 'Rejected prescriptions cannot be verified.');
      if (existing.status === PrescriptionStatus.DISPENSED) throw createHttpError(400, 'Dispensed prescriptions cannot be verified again.');

      await validatePrescriptionInventory(tx, existing.items);

      return tx.prescription.update({
        where: { prescriptionId: id },
        data: { status: PrescriptionStatus.VERIFIED },
        include: prescriptionInclude,
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    try {
      await logActivity(req.user?.userId, `verify_prescription:${prescription.prescriptionId}`);
    } catch (_) {}
    res.json(prescription);
  } catch (error: unknown) {
    const httpStatus = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (error instanceof Error && typeof httpStatus === 'number') {
      return res.status(httpStatus).json({ message: error.message });
    }
    throw error;
  }
};

export const dispensePrescription = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid prescription reference.' });

  try {
    const prescription = await prisma.$transaction(async (tx) => {
      const existing = await tx.prescription.findUnique({
        where: { prescriptionId: id },
        include: { items: true },
      });

      if (!existing) throw createHttpError(404, 'Prescription not found.');
      if (existing.status === PrescriptionStatus.DISPENSED) throw createHttpError(409, 'This prescription has already been dispensed.');
      if (existing.status === PrescriptionStatus.REJECTED) throw createHttpError(400, 'Rejected prescriptions cannot be dispensed.');
      if (existing.status !== PrescriptionStatus.VERIFIED) throw createHttpError(400, 'Verify prescription before dispensing.');

      const requestedTotals = await validatePrescriptionInventory(tx, existing.items);

      for (const [medicineId, requestedQty] of requestedTotals.entries()) {
        const updateResult = await tx.medicine.updateMany({
          where: {
            medicineId,
            approvalStatus: MedicineApprovalStatus.APPROVED,
            availableForPrescription: true,
            quantity: { gte: requestedQty },
          },
          data: {
            quantity: {
              decrement: requestedQty,
            },
          },
        });

        if (updateResult.count !== 1) {
          throw createHttpError(409, 'Prescription dispensing conflicted. Please retry.');
        }

        const medicineRecord = await tx.medicine.findUnique({
          where: { medicineId },
          select: { name: true, batchNumber: true },
        });

        await createInventoryLog(tx, {
          medicineId,
          itemName: medicineRecord?.name ?? `Medicine #${medicineId}`,
          batchNumber: medicineRecord?.batchNumber ?? '-',
          quantityChange: -requestedQty,
          actionType: InventoryStockAction.PRESCRIPTION_DISPENSED,
          performedById: req.user?.userId,
          performedByUsername: req.user?.username,
          relatedPrescriptionId: existing.prescriptionId,
        });
      }

      const dispensed = await tx.prescription.update({
        where: { prescriptionId: id },
        data: { status: PrescriptionStatus.DISPENSED },
        include: prescriptionInclude,
      });

      if (req.user?.userId) {
        await createPendingPaymentForDispensedPrescription(tx, dispensed.prescriptionId, req.user.userId);
      }

      return dispensed;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    try {
      await logActivity(req.user?.userId, `dispense_prescription:${prescription.prescriptionId}`);
    } catch (_) {}
    res.json(prescription);
  } catch (error: unknown) {
    const httpStatus = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (error instanceof Error && typeof httpStatus === 'number') {
      return res.status(httpStatus).json({ message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return res.status(409).json({ message: 'Prescription dispensing conflicted. Please retry.' });
    }
    throw error;
  }
};

export const rejectPrescription = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid prescription reference.' });

  const existing = await prisma.prescription.findUnique({ where: { prescriptionId: id } });
  if (!existing) return res.status(404).json({ message: 'Prescription not found.' });
  if (existing.status === PrescriptionStatus.DISPENSED) return res.status(400).json({ message: 'Dispensed prescriptions cannot be rejected.' });

  const prescription = await prisma.prescription.update({
    where: { prescriptionId: id },
    data: { status: PrescriptionStatus.REJECTED },
    include: prescriptionInclude,
  });

  try {
    await logActivity(req.user?.userId, `reject_prescription:${prescription.prescriptionId}`);
  } catch (_) {}
  res.json(prescription);
};
