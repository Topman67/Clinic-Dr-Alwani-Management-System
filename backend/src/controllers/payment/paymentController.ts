import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { PaymentStatus, PaymentType } from '@prisma/client';
import { generateReceiptNo } from '../../utils/receipt';
import { logActivity } from '../../utils/audit';

export const recordPayment = async (req: Request, res: Response) => {
  const { patientId, recordedById, type, amount } = req.body as {
    patientId: number;
    recordedById: number;
    type: PaymentType;
    amount: number;
  };

  const result = await prisma.$transaction(async (tx: any) => {
    const payment = await tx.payment.create({
      data: { patientId, recordedById, type, amount, status: PaymentStatus.PAID },
    });
    const receipt = await tx.receipt.create({
      data: {
        paymentId: payment.paymentId,
        receiptNo: generateReceiptNo(),
        totalAmount: payment.amount,
      },
    });
    return { payment, receipt };
  });

  try {
    await logActivity(req.user?.userId, `record_payment:${result.payment.paymentId}`);
  } catch (_) {}

  res.status(201).json(result);
};

export const listPayments = async (req: Request, res: Response) => {
  const { patientId, dateFrom, dateTo, type } = req.query as {
    patientId?: string;
    dateFrom?: string;
    dateTo?: string;
    type?: PaymentType;
  };

  const payments = await prisma.payment.findMany({
    where: {
      patientId: patientId ? Number(patientId) : undefined,
      type: type as PaymentType,
      date: {
        gte: dateFrom ? new Date(dateFrom) : undefined,
        lte: dateTo ? new Date(dateTo) : undefined,
      },
    },
    include: { patient: true, receipt: true },
    orderBy: { date: 'desc' },
  });
  res.json(payments);
};
