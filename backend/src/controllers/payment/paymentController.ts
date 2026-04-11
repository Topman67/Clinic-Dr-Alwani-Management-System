import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { PaymentMethod, PaymentStatus, PaymentType } from '@prisma/client';
import { generateReceiptNo } from '../../utils/receipt';
import { logActivity } from '../../utils/audit';

const isPaymentType = (value: unknown): value is PaymentType => {
  return value === PaymentType.CONSULTATION || value === PaymentType.APPOINTMENT;
};

const isPaymentMethod = (value: unknown): value is PaymentMethod => {
  return (
    value === PaymentMethod.CASH ||
    value === PaymentMethod.CARD ||
    value === PaymentMethod.ONLINE_TRANSFER ||
    value === PaymentMethod.E_WALLET
  );
};

const parseAmount = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
};

const normalizeRemarks = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const recordPayment = async (req: Request, res: Response) => {
  const { patientId: patientIdRaw, type, amount: amountRaw, paymentMethod, remarks } = req.body as {
    patientId?: number | string;
    type?: PaymentType;
    amount?: number | string;
    paymentMethod?: PaymentMethod;
    remarks?: string;
  };

  const patientId = Number(patientIdRaw);
  const amount = parseAmount(amountRaw);
  const recordedById = req.user?.userId;

  if (!recordedById) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ message: 'Please select a valid patient.' });
  }

  if (!isPaymentType(type)) {
    return res.status(400).json({ message: 'Please select a valid payment type.' });
  }

  if (!isPaymentMethod(paymentMethod)) {
    return res.status(400).json({ message: 'Please select a valid payment method.' });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Amount must be greater than 0.' });
  }

  const normalizedRemarks = normalizeRemarks(remarks);
  if (normalizedRemarks && normalizedRemarks.length > 500) {
    return res.status(400).json({ message: 'Remarks must be 500 characters or less.' });
  }

  const patient = await prisma.patient.findUnique({
    where: { patientId },
    select: { patientId: true, name: true, icOrPassport: true, phone: true, address: true },
  });

  if (!patient) {
    return res.status(404).json({ message: 'Patient record not found.' });
  }

  const result = await prisma.$transaction(async (tx: any) => {
    const payment = await tx.payment.create({
      data: {
        patientId,
        recordedById,
        type,
        amount,
        paymentMethod,
        remarks: normalizedRemarks,
        status: PaymentStatus.PAID,
      },
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

  res.status(201).json({
    message: 'Payment Successful',
    payment: result.payment,
    receipt: result.receipt,
    patient,
  });
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
    include: {
      patient: true,
      receipt: true,
      recordedBy: {
        select: {
          userId: true,
          username: true,
          role: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });
  res.json(payments);
};
