import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { ConsultationStatus, MedicineApprovalStatus, PaymentStatus, PaymentType } from '@prisma/client';

const parseDateRange = (dateFrom?: string, dateTo?: string) => {
  const from = dateFrom ? new Date(dateFrom) : undefined;
  const to = dateTo ? new Date(dateTo) : undefined;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return { error: 'Invalid date range.' };
  }

  if (from && to && from > to) {
    return { error: 'Date from cannot be later than date to.' };
  }

  return { from, to };
};

const isPaymentType = (value: unknown): value is PaymentType => {
  return Object.values(PaymentType).includes(value as PaymentType);
};

export const patientsReport = async (req: Request, res: Response) => {
  const query = ((req.query.query as string) || '').trim();
  const patients = await prisma.patient.findMany({
    where: {
      OR: query
        ? [
            { name: { contains: query, mode: 'insensitive' } },
            { icOrPassport: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ]
        : undefined,
    },
    include: {
      _count: {
        select: {
          prescriptions: true,
          payments: true,
        },
      },
      payments: {
        select: {
          amount: true,
          type: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const items = patients.map((p) => {
    const totalPaid = p.payments.reduce((sum, pay) => sum + Number(pay.amount), 0);
    return {
      patientId: p.patientId,
      name: p.name,
      icOrPassport: p.icOrPassport,
      phone: p.phone,
      address: p.address,
      createdAt: p.createdAt,
      prescriptionsCount: p._count.prescriptions,
      paymentsCount: p._count.payments,
      totalPaid,
    };
  });

  res.json(items);
};

export const prescriptionsReport = async (req: Request, res: Response) => {
  const { patientId, medicineId, dateFrom, dateTo } = req.query as {
    patientId?: string;
    medicineId?: string;
    dateFrom?: string;
    dateTo?: string;
  };

  const parsedDate = parseDateRange(dateFrom, dateTo);
  if ('error' in parsedDate) {
    return res.status(400).json({ message: parsedDate.error });
  }

  const prescriptions = await prisma.prescription.findMany({
    where: {
      patientId: patientId ? Number(patientId) : undefined,
      date: {
        gte: parsedDate.from,
        lte: parsedDate.to,
      },
      items: medicineId
        ? {
            some: {
              medicineId: Number(medicineId),
            },
          }
        : undefined,
    },
    include: {
      patient: {
        select: {
          patientId: true,
          name: true,
          icOrPassport: true,
        },
      },
      doctor: {
        select: {
          userId: true,
          username: true,
        },
      },
      items: {
        include: {
          medicine: {
            select: {
              medicineId: true,
              name: true,
              batchNumber: true,
            },
          },
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  res.json(prescriptions);
};

export const consultationsReport = async (req: Request, res: Response) => {
  const { patientId, dateFrom, dateTo, status, query } = req.query as {
    patientId?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    query?: string;
  };

  const parsedDate = parseDateRange(dateFrom, dateTo);
  if ('error' in parsedDate) {
    return res.status(400).json({ message: parsedDate.error });
  }

  const normalizedStatus = status?.toUpperCase() as ConsultationStatus | undefined;
  if (normalizedStatus && !Object.values(ConsultationStatus).includes(normalizedStatus)) {
    return res.status(400).json({ message: 'Invalid consultation status.' });
  }

  const keyword = query?.trim();
  const consultations = await prisma.consultation.findMany({
    where: {
      patientId: patientId ? Number(patientId) : undefined,
      status: normalizedStatus,
      createdAt: {
        gte: parsedDate.from,
        lte: parsedDate.to,
      },
      patient: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { icOrPassport: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
    },
    include: {
      patient: { select: { patientId: true, name: true, icOrPassport: true, phone: true } },
      doctor: { select: { userId: true, username: true } },
      appointment: { select: { appointmentId: true, dateTime: true, type: true } },
      prescription: { select: { prescriptionId: true } },
      payment: { select: { paymentId: true, status: true, amount: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(consultations);
};

export const paymentSummary = async (req: Request, res: Response) => {
  const { dateFrom, dateTo, type } = req.query as { dateFrom?: string; dateTo?: string; type?: string };

  const parsedDate = parseDateRange(dateFrom, dateTo);
  if ('error' in parsedDate) {
    return res.status(400).json({ message: parsedDate.error });
  }

  if (type && !isPaymentType(type)) {
    return res.status(400).json({ message: 'Invalid payment type.' });
  }

  const payments = await prisma.payment.findMany({
    where: {
      type: type ? (type as PaymentType) : undefined,
      date: {
        gte: parsedDate.from,
        lte: parsedDate.to,
      },
    },
    include: {
      patient: {
        select: {
          patientId: true,
          name: true,
        },
      },
      receipt: {
        select: {
          receiptId: true,
          receiptNo: true,
          date: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });
  const total = payments.reduce((sum: number, p: { amount: any }) => sum + Number(p.amount), 0);
  res.json({ count: payments.length, total, payments });
};

export const salesReport = async (req: Request, res: Response) => {
  const { dateFrom, dateTo, type, status, query } = req.query as {
    dateFrom?: string;
    dateTo?: string;
    type?: string;
    status?: string;
    query?: string;
  };

  const parsedDate = parseDateRange(dateFrom, dateTo);
  if ('error' in parsedDate) {
    return res.status(400).json({ message: parsedDate.error });
  }

  if (type && !isPaymentType(type)) {
    return res.status(400).json({ message: 'Invalid payment type.' });
  }
  const normalizedStatus = status?.toUpperCase() as PaymentStatus | undefined;
  if (normalizedStatus && !Object.values(PaymentStatus).includes(normalizedStatus)) {
    return res.status(400).json({ message: 'Invalid payment status.' });
  }

  const keyword = query?.trim();
  const sales = await prisma.payment.findMany({
    where: {
      type: type ? (type as PaymentType) : undefined,
      status: normalizedStatus,
      date: {
        gte: parsedDate.from,
        lte: parsedDate.to,
      },
      OR: keyword
        ? [
            { patient: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
            { patient: { is: { icOrPassport: { contains: keyword, mode: 'insensitive' } } } },
            { receipt: { is: { receiptNo: { contains: keyword, mode: 'insensitive' } } } },
            { medicineItems: { some: { medicine: { name: { contains: keyword, mode: 'insensitive' } } } } },
          ]
        : undefined,
    },
    include: {
      patient: { select: { name: true, icOrPassport: true, phone: true } },
      receipt: true,
      medicineItems: {
        include: {
          medicine: { select: { name: true, batchNumber: true, stockUnit: true } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  const total = sales.reduce((sum, sale) => sum + Number(sale.receipt?.totalAmount ?? sale.amount), 0);
  res.json({ count: sales.length, total, sales });
};

export const receiptsReport = async (req: Request, res: Response) => {
  const { dateFrom, dateTo, receiptNo, type } = req.query as {
    dateFrom?: string;
    dateTo?: string;
    receiptNo?: string;
    type?: string;
  };

  const parsedDate = parseDateRange(dateFrom, dateTo);
  if ('error' in parsedDate) {
    return res.status(400).json({ message: parsedDate.error });
  }

  if (type && !isPaymentType(type)) {
    return res.status(400).json({ message: 'Invalid payment type.' });
  }

  const receipts = await prisma.receipt.findMany({
    where: {
      receiptNo: receiptNo ? { contains: receiptNo, mode: 'insensitive' } : undefined,
      date: {
        gte: parsedDate.from,
        lte: parsedDate.to,
      },
      payment: type ? { type: type as PaymentType } : undefined,
    },
    include: { payment: { include: { patient: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(receipts);
};

export const inventoryLowStock = async (_req: Request, res: Response) => {
  const items = await prisma.medicine.findMany({
    where: {
      approvalStatus: MedicineApprovalStatus.APPROVED,
      quantity: { lt: 10 },
    },
    orderBy: { quantity: 'asc' },
  });
  res.json(items);
};

export const inventoryExpiring = async (req: Request, res: Response) => {
  const days = Number(req.query.days || 30);
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const items = await prisma.medicine.findMany({
    where: {
      approvalStatus: MedicineApprovalStatus.APPROVED,
      expiryDate: { lte: cutoff },
    },
    orderBy: { expiryDate: 'asc' },
  });
  res.json(items);
};
