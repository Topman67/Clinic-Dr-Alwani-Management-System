import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const parseMedicinePayload = (body: Record<string, unknown>) => {
  const name = normalize(body.name);
  const batchNumber = normalize(body.batchNumber);
  const expiryDateRaw = normalize(body.expiryDate);
  const quantity = Number(body.quantity);
  const price = Number(body.price);

  const expiryDate = new Date(expiryDateRaw);

  if (!name || !batchNumber || !expiryDateRaw) {
    return { error: 'Missing or invalid fields.' as const };
  }

  if (!Number.isFinite(quantity) || quantity < 0) {
    return { error: 'Missing or invalid fields.' as const };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Missing or invalid fields.' as const };
  }

  if (Number.isNaN(expiryDate.getTime())) {
    return { error: 'Missing or invalid fields.' as const };
  }

  return {
    data: {
      name,
      batchNumber,
      quantity: Math.trunc(quantity),
      expiryDate,
      price,
    },
  };
};

export const addMedicine = async (req: Request, res: Response) => {
  const parsed = parseMedicinePayload(req.body as Record<string, unknown>);
  if ('error' in parsed) {
    return res.status(400).json({ message: parsed.error });
  }

  const duplicate = await prisma.medicine.findUnique({
    where: {
      name_batchNumber: {
        name: parsed.data.name,
        batchNumber: parsed.data.batchNumber,
      },
    },
  });

  if (duplicate) {
    return res.status(409).json({ message: 'Medicine already exists.' });
  }

  const medicine = await prisma.medicine.create({
    data: parsed.data,
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

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Missing or invalid fields.' });
  }

  const parsed = parseMedicinePayload(req.body as Record<string, unknown>);
  if ('error' in parsed) {
    return res.status(400).json({ message: parsed.error });
  }

  const existing = await prisma.medicine.findUnique({ where: { medicineId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'Medicine not found.' });
  }

  const duplicate = await prisma.medicine.findFirst({
    where: {
      medicineId: { not: id },
      name: parsed.data.name,
      batchNumber: parsed.data.batchNumber,
    },
  });

  if (duplicate) {
    return res.status(409).json({ message: 'Medicine already exists.' });
  }

  const medicine = await prisma.medicine.update({
    where: { medicineId: id },
    data: parsed.data,
  });
  try {
    await logActivity(req.user?.userId, `update_medicine:${medicine.medicineId}`);
  } catch (_) {}
  res.json(medicine);
};

export const deleteMedicine = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Missing or invalid fields.' });
  }

  const existing = await prisma.medicine.findUnique({ where: { medicineId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'Medicine not found.' });
  }

  await prisma.medicine.delete({ where: { medicineId: id } });
  try {
    await logActivity(req.user?.userId, `delete_medicine:${id}`);
  } catch (_) {}
  res.json({ message: 'Medicine Deleted Successfully' });
};
