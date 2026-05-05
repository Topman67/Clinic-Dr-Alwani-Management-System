import { MedicineApprovalStatus } from '@prisma/client';
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

const parseMedicineId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeOptionalReason = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
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
    data: {
      ...parsed.data,
      approvalStatus: MedicineApprovalStatus.PENDING,
      requestedById: req.user?.userId ?? null,
      requestedByUsername: req.user?.username ?? null,
    },
  });

  try {
    await logActivity(req.user?.userId, `request_medicine:${medicine.medicineId}`);
  } catch (_) {}

  res.status(201).json({
    ...medicine,
    message: 'Medicine submitted for doctor approval.',
  });
};

export const listMedicine = async (req: Request, res: Response) => {
  const query = (req.query.query as string) || '';
  const includePending = req.query.includePending === 'true';
  const approvalStatusRaw = typeof req.query.approvalStatus === 'string' ? req.query.approvalStatus.toUpperCase() : '';
  const approvalStatus = Object.values(MedicineApprovalStatus).includes(approvalStatusRaw as MedicineApprovalStatus)
    ? (approvalStatusRaw as MedicineApprovalStatus)
    : undefined;

  const medicines = await prisma.medicine.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { batchNumber: { contains: query, mode: 'insensitive' } },
      ],
      approvalStatus: approvalStatus ?? (includePending ? undefined : MedicineApprovalStatus.APPROVED),
    },
    orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
  });
  const ordered = medicines.sort((a, b) => {
    const rank = (status: MedicineApprovalStatus) => {
      if (status === MedicineApprovalStatus.APPROVED) return 1;
      if (status === MedicineApprovalStatus.PENDING) return 2;
      return 3;
    };
    const rankDiff = rank(a.approvalStatus) - rank(b.approvalStatus);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  res.json(ordered);
};

export const approveMedicine = async (req: Request, res: Response) => {
  const id = parseMedicineId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: 'Missing or invalid fields.' });
  }

  const medicine = await prisma.medicine.findUnique({ where: { medicineId: id } });
  if (!medicine) {
    return res.status(404).json({ message: 'Medicine not found.' });
  }

  if (medicine.approvalStatus === MedicineApprovalStatus.APPROVED) {
    return res.status(400).json({ message: 'Medicine is already approved.' });
  }

  const updated = await prisma.medicine.update({
    where: { medicineId: id },
    data: {
      approvalStatus: MedicineApprovalStatus.APPROVED,
      approvedById: req.user?.userId ?? null,
      approvedByUsername: req.user?.username ?? null,
      approvedAt: new Date(),
      rejectedById: null,
      rejectedByUsername: null,
      rejectedAt: null,
    },
  });

  try {
    await logActivity(req.user?.userId, `approve_medicine:${updated.medicineId}`);
  } catch (_) {}

  res.json({
    ...updated,
    message: 'Medicine approved successfully.',
  });
};

export const rejectMedicine = async (req: Request, res: Response) => {
  const id = parseMedicineId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: 'Missing or invalid fields.' });
  }

  const medicine = await prisma.medicine.findUnique({ where: { medicineId: id } });
  if (!medicine) {
    return res.status(404).json({ message: 'Medicine not found.' });
  }

  if (medicine.approvalStatus === MedicineApprovalStatus.REJECTED) {
    return res.status(400).json({ message: 'Medicine is already rejected.' });
  }

  if (medicine.approvalStatus === MedicineApprovalStatus.APPROVED) {
    return res.status(400).json({ message: 'Approved medicine cannot be rejected.' });
  }

  const rejectionReason = normalizeOptionalReason(req.body?.rejectionReason);

  const updated = await prisma.medicine.update({
    where: { medicineId: id },
    data: {
      approvalStatus: MedicineApprovalStatus.REJECTED,
      rejectedById: req.user?.userId ?? null,
      rejectedByUsername: req.user?.username ?? null,
      rejectedAt: new Date(),
      rejectionReason,
    },
  });

  try {
    await logActivity(
      req.user?.userId,
      `reject_medicine:${updated.medicineId}${rejectionReason ? `:reason:${rejectionReason}` : ''}`,
    );
  } catch (_) {}

  res.json({
    ...updated,
    message: 'Medicine rejected successfully.',
  });
};

export const resubmitMedicine = async (req: Request, res: Response) => {
  const id = parseMedicineId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: 'Missing or invalid fields.' });
  }

  const medicine = await prisma.medicine.findUnique({ where: { medicineId: id } });
  if (!medicine) {
    return res.status(404).json({ message: 'Medicine not found.' });
  }

  if (medicine.approvalStatus !== MedicineApprovalStatus.REJECTED) {
    return res.status(400).json({ message: 'Only rejected medicines can be resubmitted.' });
  }

  const updated = await prisma.medicine.update({
    where: { medicineId: id },
    data: {
      approvalStatus: MedicineApprovalStatus.PENDING,
      requestedById: req.user?.userId ?? null,
      requestedByUsername: req.user?.username ?? null,
      rejectedById: null,
      rejectedByUsername: null,
      rejectedAt: null,
      rejectionReason: null,
      approvedById: null,
      approvedByUsername: null,
      approvedAt: null,
    },
  });

  try {
    await logActivity(req.user?.userId, `resubmit_medicine:${updated.medicineId}`);
  } catch (_) {}

  return res.json({
    ...updated,
    message: 'Medicine resubmitted for doctor review.',
  });
};

export const updateMedicine = async (req: Request, res: Response) => {
  const id = parseMedicineId(req.params.id);

  if (!id) {
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

  const shouldResubmit = req.query.resubmit === 'true';
  const nextApprovalStatus =
    shouldResubmit && existing.approvalStatus === MedicineApprovalStatus.REJECTED
      ? MedicineApprovalStatus.PENDING
      : existing.approvalStatus;

  const medicine = await prisma.medicine.update({
    where: { medicineId: id },
    data: {
      ...parsed.data,
      approvalStatus: nextApprovalStatus,
      requestedById: nextApprovalStatus === MedicineApprovalStatus.PENDING ? req.user?.userId ?? null : existing.requestedById,
      requestedByUsername:
        nextApprovalStatus === MedicineApprovalStatus.PENDING ? req.user?.username ?? null : existing.requestedByUsername,
      rejectedById: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.rejectedById,
      rejectedByUsername: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.rejectedByUsername,
      rejectedAt: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.rejectedAt,
      rejectionReason: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.rejectionReason,
      approvedById: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.approvedById,
      approvedByUsername: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.approvedByUsername,
      approvedAt: nextApprovalStatus === MedicineApprovalStatus.PENDING ? null : existing.approvedAt,
    },
  });
  try {
    await logActivity(req.user?.userId, `update_medicine:${medicine.medicineId}`);
  } catch (_) {}
  res.json(medicine);
};

export const deleteMedicine = async (req: Request, res: Response) => {
  const id = parseMedicineId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Missing or invalid fields.' });
  }

  const existing = await prisma.medicine.findUnique({ where: { medicineId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'Medicine not found.' });
  }

  if (existing.approvalStatus === MedicineApprovalStatus.REJECTED) {
    return res.status(400).json({ message: 'Rejected medicines are retained for audit and cannot be deleted.' });
  }

  await prisma.medicine.delete({ where: { medicineId: id } });
  try {
    await logActivity(req.user?.userId, `delete_medicine:${id}`);
  } catch (_) {}
  res.json({ message: 'Medicine Deleted Successfully' });
};
