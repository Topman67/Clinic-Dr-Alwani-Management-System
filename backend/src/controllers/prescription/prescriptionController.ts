import { Request, Response } from 'express';
import { AppointmentStatus, ConsultationStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

const isNonEmptyText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const WALKIN_CUSTOMER_PREFIX = 'WALKIN-';

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

  const consultation = await prisma.consultation.findUnique({
    where: { consultationId: targetConsultationId },
    include: { prescription: { select: { prescriptionId: true } } },
  });
  if (!consultation) {
    return res.status(404).json({ message: 'Consultation not found.' });
  }

  if (consultation.patientId !== patientId) {
    return res.status(400).json({ message: 'Consultation does not match selected patient.' });
  }

  if (consultation.appointmentId && appointmentId !== undefined && consultation.appointmentId !== appointmentId) {
    return res.status(400).json({ message: 'Consultation does not match selected appointment.' });
  }

  if (consultation.status !== ConsultationStatus.COMPLETED) {
    return res.status(400).json({ message: 'Complete consultation before creating prescription.' });
  }

  if (consultation.prescription) {
    return res.status(409).json({ message: 'Prescription already exists for this consultation.' });
  }

  const targetAppointmentId = appointmentId ?? consultation.appointmentId ?? undefined;

  if (targetAppointmentId !== undefined) {
    const appointment = await prisma.appointment.findUnique({ where: { appointmentId: targetAppointmentId } });
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    if (appointment.patientId !== patientId) {
      return res.status(400).json({ message: 'Appointment does not match selected patient.' });
    }

    if (appointment.status === AppointmentStatus.CANCELLED || appointment.status === AppointmentStatus.NO_SHOW) {
      return res.status(400).json({ message: 'Cannot create prescription for cancelled or no-show appointment.' });
    }
  }

  const prescription = await prisma.$transaction(async (tx) => {
    const created = await tx.prescription.create({
      data: {
        patientId,
        doctorId,
        consultationId: targetConsultationId,
        appointmentId: targetAppointmentId,
        notes,
        items: {
          create: items.map((it) => ({ ...it })),
        },
      },
      include: { items: true },
    });

    if (targetAppointmentId !== undefined) {
      await tx.appointment.update({
        where: { appointmentId: targetAppointmentId },
        data: { status: AppointmentStatus.COMPLETED },
      });
    }

    return created;
  });

  res.status(201).json(prescription);
  try {
    await logActivity(req.user?.userId, `create_prescription:${prescription.prescriptionId}`);
  } catch (_) {}
};

export const listPrescriptions = async (req: Request, res: Response) => {
  const { patientId, dateFrom, dateTo } = req.query as { patientId?: string; dateFrom?: string; dateTo?: string };

  const prescriptions = await prisma.prescription.findMany({
    where: {
      patientId: patientId ? Number(patientId) : undefined,
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
        gte: dateFrom ? new Date(dateFrom) : undefined,
        lte: dateTo ? new Date(dateTo) : undefined,
      },
    },
    include: { patient: true, consultation: true, items: { include: { medicine: true } } },
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
    include: { patient: true, consultation: true, items: { include: { medicine: true } } },
  });
  if (!prescription) return res.status(404).json({ message: 'Not found' });
  res.json(prescription);
};
