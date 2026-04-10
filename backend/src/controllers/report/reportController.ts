import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';

export const paymentSummary = async (req: Request, res: Response) => {
  const { dateFrom, dateTo, type } = req.query as { dateFrom?: string; dateTo?: string; type?: string };
  const payments = await prisma.payment.findMany({
    where: {
      type: type ? (type as any) : undefined,
      date: {
        gte: dateFrom ? new Date(dateFrom) : undefined,
        lte: dateTo ? new Date(dateTo) : undefined,
      },
    },
  });
  const total = payments.reduce((sum: number, p: { amount: any }) => sum + Number(p.amount), 0);
  res.json({ count: payments.length, total, payments });
};

export const receiptsReport = async (req: Request, res: Response) => {
  const { dateFrom, dateTo, receiptNo } = req.query as { dateFrom?: string; dateTo?: string; receiptNo?: string };
  const receipts = await prisma.receipt.findMany({
    where: {
      receiptNo: receiptNo ? { contains: receiptNo, mode: 'insensitive' } : undefined,
      date: {
        gte: dateFrom ? new Date(dateFrom) : undefined,
        lte: dateTo ? new Date(dateTo) : undefined,
      },
    },
    include: { payment: { include: { patient: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(receipts);
};

export const inventoryLowStock = async (_req: Request, res: Response) => {
  const items = await prisma.medicine.findMany({ where: { quantity: { lt: 10 } }, orderBy: { quantity: 'asc' } });
  res.json(items);
};

export const inventoryExpiring = async (req: Request, res: Response) => {
  const days = Number(req.query.days || 30);
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const items = await prisma.medicine.findMany({
    where: { expiryDate: { lte: cutoff } },
    orderBy: { expiryDate: 'asc' },
  });
  res.json(items);
};
