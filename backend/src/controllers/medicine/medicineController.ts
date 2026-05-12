import { InventoryCategory, InventoryStockAction, MedicineApprovalStatus, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const normalizeOptional = (value: unknown) => {
  const normalized = normalize(value);
  return normalized ? normalized.slice(0, 180) : null;
};

const isInventoryCategory = (value: unknown): value is InventoryCategory => {
  return typeof value === 'string' && Object.values(InventoryCategory).includes(value as InventoryCategory);
};

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const toDateKey = (value: Date) => value.toISOString().slice(0, 10);
const isExpiredMedicine = (expiryDate: Date) => toDateKey(expiryDate) < toDateKey(new Date());

const parseMedicinePayload = (body: Record<string, unknown>) => {
  const name = normalize(body.name);
  const category = isInventoryCategory(body.category) ? body.category : InventoryCategory.MEDICINE;
  const brand = normalizeOptional(body.brand);
  const content = normalizeOptional(body.content);
  const packaging = normalizeOptional(body.packaging);
  const companyName = normalizeOptional(body.companyName);
  const availableForPrescription = parseBoolean(body.availableForPrescription, category === InventoryCategory.MEDICINE || category === InventoryCategory.CONTROLLED_MEDICINE);
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
      category,
      brand,
      content,
      packaging,
      companyName,
      availableForPrescription,
      batchNumber,
      quantity: Math.trunc(quantity),
      expiryDate,
      price,
    },
  };
};

const createInventoryLog = async (
  tx: Prisma.TransactionClient,
  params: {
    medicineId: number;
    itemName: string;
    batchNumber: string;
    quantityChange: number;
    actionType: InventoryStockAction;
    performedById?: number | null;
    performedByUsername?: string | null;
    relatedPrescriptionId?: number | null;
  },
) => {
  await tx.inventoryStockLog.create({
    data: {
      medicineId: params.medicineId,
      itemName: params.itemName,
      batchNumber: params.batchNumber,
      quantityChange: params.quantityChange,
      actionType: params.actionType,
      performedById: params.performedById ?? null,
      performedByUsername: params.performedByUsername ?? null,
      relatedPrescriptionId: params.relatedPrescriptionId ?? null,
    },
  });
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

  const medicine = await prisma.$transaction(async (tx) => {
    const created = await tx.medicine.create({
      data: {
        ...parsed.data,
        approvalStatus: MedicineApprovalStatus.PENDING,
        requestedById: req.user?.userId ?? null,
        requestedByUsername: req.user?.username ?? null,
      },
    });

    await createInventoryLog(tx, {
      medicineId: created.medicineId,
      itemName: created.name,
      batchNumber: created.batchNumber,
      quantityChange: created.quantity,
      actionType: InventoryStockAction.STOCK_ADDED,
      performedById: req.user?.userId,
      performedByUsername: req.user?.username,
    });

    return created;
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
  const categoryRaw = typeof req.query.category === 'string' ? req.query.category.toUpperCase() : '';
  const category = Object.values(InventoryCategory).includes(categoryRaw as InventoryCategory)
    ? (categoryRaw as InventoryCategory)
    : undefined;
  const expiryStatus = typeof req.query.expiryStatus === 'string' ? req.query.expiryStatus.toUpperCase() : '';
  const lowStock = req.query.lowStock === 'true';
  const availableForPrescription = typeof req.query.availableForPrescription === 'string'
    ? parseBoolean(req.query.availableForPrescription, false)
    : undefined;
  const approvalStatusRaw = typeof req.query.approvalStatus === 'string' ? req.query.approvalStatus.toUpperCase() : '';
  const approvalStatus = Object.values(MedicineApprovalStatus).includes(approvalStatusRaw as MedicineApprovalStatus)
    ? (approvalStatusRaw as MedicineApprovalStatus)
    : undefined;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nearExpiryCutoff = new Date(today);
  nearExpiryCutoff.setDate(nearExpiryCutoff.getDate() + 30);

  const expiryWhere =
    expiryStatus === 'EXPIRED'
      ? { expiryDate: { lt: today } }
      : expiryStatus === 'NEAR_EXPIRY'
        ? { expiryDate: { gte: today, lte: nearExpiryCutoff } }
        : expiryStatus === 'VALID'
          ? { expiryDate: { gt: nearExpiryCutoff } }
          : {};

  const medicines = await prisma.medicine.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { batchNumber: { contains: query, mode: 'insensitive' } },
        { brand: { contains: query, mode: 'insensitive' } },
        { companyName: { contains: query, mode: 'insensitive' } },
      ],
      category,
      approvalStatus: approvalStatus ?? (includePending ? undefined : MedicineApprovalStatus.APPROVED),
      availableForPrescription,
      quantity: lowStock ? { lte: 10 } : undefined,
      ...expiryWhere,
    },
    orderBy: [{ approvalStatus: 'asc' }, { expiryDate: 'asc' }, { createdAt: 'desc' }],
  });
  const ordered = medicines.sort((a, b) => {
    const rank = (status: MedicineApprovalStatus) => {
      if (status === MedicineApprovalStatus.APPROVED) return 1;
      if (status === MedicineApprovalStatus.PENDING) return 2;
      return 3;
    };
    const rankDiff = rank(a.approvalStatus) - rank(b.approvalStatus);
    if (rankDiff !== 0) return rankDiff;
    const expiryDiff = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    if (expiryDiff !== 0) return expiryDiff;
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

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.medicine.update({
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

    await createInventoryLog(tx, {
      medicineId: item.medicineId,
      itemName: item.name,
      batchNumber: item.batchNumber,
      quantityChange: 0,
      actionType: InventoryStockAction.INVENTORY_APPROVED,
      performedById: req.user?.userId,
      performedByUsername: req.user?.username,
    });

    return item;
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

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.medicine.update({
      where: { medicineId: id },
      data: {
        approvalStatus: MedicineApprovalStatus.REJECTED,
        rejectedById: req.user?.userId ?? null,
        rejectedByUsername: req.user?.username ?? null,
        rejectedAt: new Date(),
        rejectionReason,
      },
    });

    await createInventoryLog(tx, {
      medicineId: item.medicineId,
      itemName: item.name,
      batchNumber: item.batchNumber,
      quantityChange: 0,
      actionType: InventoryStockAction.INVENTORY_REJECTED,
      performedById: req.user?.userId,
      performedByUsername: req.user?.username,
    });

    return item;
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

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.medicine.update({
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

    await createInventoryLog(tx, {
      medicineId: item.medicineId,
      itemName: item.name,
      batchNumber: item.batchNumber,
      quantityChange: 0,
      actionType: InventoryStockAction.ITEM_RESUBMITTED,
      performedById: req.user?.userId,
      performedByUsername: req.user?.username,
    });

    return item;
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

  const medicine = await prisma.$transaction(async (tx) => {
    const item = await tx.medicine.update({
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

    await createInventoryLog(tx, {
      medicineId: item.medicineId,
      itemName: item.name,
      batchNumber: item.batchNumber,
      quantityChange: item.quantity - existing.quantity,
      actionType: InventoryStockAction.ITEM_EDITED,
      performedById: req.user?.userId,
      performedByUsername: req.user?.username,
    });

    return item;
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

  await prisma.$transaction(async (tx) => {
    await createInventoryLog(tx, {
      medicineId: existing.medicineId,
      itemName: existing.name,
      batchNumber: existing.batchNumber,
      quantityChange: -existing.quantity,
      actionType: InventoryStockAction.ITEM_DELETED,
      performedById: req.user?.userId,
      performedByUsername: req.user?.username,
    });
    await tx.medicine.delete({ where: { medicineId: id } });
  });
  try {
    await logActivity(req.user?.userId, `delete_medicine:${id}`);
  } catch (_) {}
  res.json({ message: 'Medicine Deleted Successfully' });
};

export const listInventoryHistory = async (_req: Request, res: Response) => {
  const logs = await prisma.inventoryStockLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 80,
  });

  res.json(logs);
};

export { createInventoryLog, isExpiredMedicine };
