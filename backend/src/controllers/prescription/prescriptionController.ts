import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

export const createPrescription = async (req: Request, res: Response) => {
  const { patientId, doctorId, notes, items } = req.body as {
    patientId: number;
    doctorId: number;
    notes?: string;
    items: { medicineId: number; dosage: string; frequency: string; duration: string; qty: number }[];
  };

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
  const prescription = await prisma.prescription.findUnique({
    where: { prescriptionId: id },
    include: { patient: true, items: { include: { medicine: true } } },
  });
  if (!prescription) return res.status(404).json({ message: 'Not found' });
  res.json(prescription);
};
