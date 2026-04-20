import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

const isNonEmptyText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const WALKIN_CUSTOMER_PREFIX = 'WALKIN-';

export const createPrescription = async (req: Request, res: Response) => {
  const { patientId, doctorId, notes, items } = req.body as {
    patientId: number;
    doctorId: number;
    notes?: string;
    items: { medicineId: number; dosage: string; frequency: string; duration: string; qty: number }[];
  };

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
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

  if (patient.icOrPassport?.toUpperCase().startsWith(WALKIN_CUSTOMER_PREFIX)) {
    return res.status(400).json({ message: 'Walk-in sales customers are not available in prescription module.' });
  }

  const doctor = await prisma.user.findUnique({ where: { userId: doctorId } });
  if (!doctor) {
    return res.status(400).json({ message: 'Incomplete prescription data.' });
  }

  const prescription = await prisma.prescription.create({
    data: {
      patientId,
      doctorId,
      notes,
      items: {
        create: items.map((it) => ({ ...it })),
      },
    },
    include: { items: true },
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
    include: { patient: true, items: { include: { medicine: true } } },
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
    include: { patient: true, items: { include: { medicine: true } } },
  });
  if (!prescription) return res.status(404).json({ message: 'Not found' });
  res.json(prescription);
};
