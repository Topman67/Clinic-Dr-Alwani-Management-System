import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

export const addMedicine = async (req: Request, res: Response) => {
  const { name, batchNumber, quantity, expiryDate, price } = req.body;
  const medicine = await prisma.medicine.create({
    data: { name, batchNumber, quantity, expiryDate: new Date(expiryDate), price },
  });
  try {
    await logActivity(req.user?.userId, `add_medicine:${medicine.medicineId}`);
  } catch (_) {}
  res.status(201).json(medicine);
};

export const listMedicine = async (req: Request, res: Response) => {
  const query = (req.query.query as string) || '';
  const medicines = await prisma.medicine.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { batchNumber: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(medicines);
};

export const updateMedicine = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, batchNumber, quantity, expiryDate, price } = req.body;
  const medicine = await prisma.medicine.update({
    where: { medicineId: id },
    data: { name, batchNumber, quantity, expiryDate: new Date(expiryDate), price },
  });
  try {
    await logActivity(req.user?.userId, `update_medicine:${medicine.medicineId}`);
  } catch (_) {}
  res.json(medicine);
};

export const deleteMedicine = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await prisma.medicine.delete({ where: { medicineId: id } });
  try {
    await logActivity(req.user?.userId, `delete_medicine:${id}`);
  } catch (_) {}
  res.json({ message: 'Medicine deleted' });
};
