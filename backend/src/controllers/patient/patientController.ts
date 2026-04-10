import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';

export const createPatient = async (req: Request, res: Response) => {
  const { name, icOrPassport, phone } = req.body;
  const patient = await prisma.patient.create({ data: { name, icOrPassport, phone } });
  // audit
  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `create_patient:${patient.patientId}`);
  } catch (_) {}

  res.status(201).json(patient);
};

export const listPatients = async (req: Request, res: Response) => {
  const query = (req.query.query as string) || '';
  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { icOrPassport: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(patients);
};

export const getPatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const patient = await prisma.patient.findUnique({ where: { patientId: id } });
  if (!patient) return res.status(404).json({ message: 'Not found' });
  res.json(patient);
};

export const updatePatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, icOrPassport, phone } = req.body;
  const patient = await prisma.patient.update({ where: { patientId: id }, data: { name, icOrPassport, phone } });
  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `update_patient:${patient.patientId}`);
  } catch (_) {}
  res.json(patient);
};
