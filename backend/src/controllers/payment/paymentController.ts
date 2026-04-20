import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { PaymentMethod, PaymentStatus, PaymentType } from '@prisma/client';
import { generateReceiptNo } from '../../utils/receipt';
import { logActivity } from '../../utils/audit';

type WalkInMedicineInput = {
  medicineId?: number | string;
  qty?: number | string;
};

const WALKIN_CUSTOMER_IC = 'WALKIN-CUSTOMER';
const WALKIN_CUSTOMER_NAME = 'Walk-in Customer';
const WALKIN_CUSTOMER_PHONE = 'N/A';

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

const parseWalkInItems = (value: unknown): Array<{ medicineId: number; qty: number }> | null => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const parsed = value
    .map((raw) => raw as WalkInMedicineInput)
    .map((item) => ({
      medicineId: Number(item.medicineId),
      qty: Math.trunc(Number(item.qty)),
    }))
    .filter((item) => Number.isInteger(item.medicineId) && item.medicineId > 0 && Number.isInteger(item.qty) && item.qty > 0);

  if (parsed.length === 0) return null;

  const merged = new Map<number, number>();
  parsed.forEach((item) => {
    merged.set(item.medicineId, (merged.get(item.medicineId) ?? 0) + item.qty);
  });

  return [...merged.entries()].map(([medicineId, qty]) => ({ medicineId, qty }));
};

export const listWalkInMedicines = async (_req: Request, res: Response) => {
  const medicines = await prisma.medicine.findMany({
    where: {
      quantity: { gt: 0 },
    },
    select: {
      medicineId: true,
      name: true,
      batchNumber: true,
      quantity: true,
      price: true,
      expiryDate: true,
    },
    orderBy: [{ name: 'asc' }, { batchNumber: 'asc' }],
  });

  return res.json(medicines);
};

export const recordWalkInMedicineSale = async (req: Request, res: Response) => {
  const { patientId: patientIdRaw, paymentMethod, remarks, items: itemsRaw } = req.body as {
    patientId?: number | string;
    paymentMethod?: PaymentMethod;
    remarks?: string;
    items?: unknown;
  };

  const parsedPatientId = Number(patientIdRaw);
  const hasExplicitPatientId = Number.isInteger(parsedPatientId) && parsedPatientId > 0;
  const recordedById = req.user?.userId;

  if (!recordedById) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (patientIdRaw !== undefined && patientIdRaw !== null && !hasExplicitPatientId) {
    return res.status(400).json({ message: 'Please select a valid patient.' });
  }

  if (!isPaymentMethod(paymentMethod)) {
    return res.status(400).json({ message: 'Please select a valid payment method.' });
  }

  const normalizedRemarks = normalizeRemarks(remarks);
  if (normalizedRemarks && normalizedRemarks.length > 500) {
    return res.status(400).json({ message: 'Remarks must be 500 characters or less.' });
  }

  const requestedItems = parseWalkInItems(itemsRaw);
  if (!requestedItems) {
    return res.status(400).json({ message: 'Please add at least one medicine item.' });
  }

  const patient = hasExplicitPatientId
    ? await prisma.patient.findUnique({
        where: { patientId: parsedPatientId },
        select: { patientId: true, name: true, icOrPassport: true, phone: true, address: true },
      })
    : await prisma.patient.upsert({
        where: { icOrPassport: WALKIN_CUSTOMER_IC },
        update: {
          name: WALKIN_CUSTOMER_NAME,
          phone: WALKIN_CUSTOMER_PHONE,
        },
        create: {
          name: WALKIN_CUSTOMER_NAME,
          icOrPassport: WALKIN_CUSTOMER_IC,
          phone: WALKIN_CUSTOMER_PHONE,
          address: null,
        },
        select: { patientId: true, name: true, icOrPassport: true, phone: true, address: true },
      });

  if (!patient) {
    return res.status(404).json({ message: 'Patient record not found.' });
  }

  const medicineIds = requestedItems.map((item) => item.medicineId);
  const medicines = await prisma.medicine.findMany({
    where: {
      medicineId: { in: medicineIds },
    },
    select: {
      medicineId: true,
      name: true,
      batchNumber: true,
      quantity: true,
      price: true,
    },
  });

  if (medicines.length !== requestedItems.length) {
    return res.status(404).json({ message: 'One or more medicines were not found.' });
  }

  const medicineMap = new Map(medicines.map((m) => [m.medicineId, m]));

  for (const item of requestedItems) {
    const medicine = medicineMap.get(item.medicineId);
    if (!medicine || medicine.quantity < item.qty) {
      return res.status(400).json({
        message: `Insufficient stock for ${medicine?.name ?? `medicine #${item.medicineId}`}.`,
      });
    }
  }

  const pricedItems = requestedItems.map((item) => {
    const medicine = medicineMap.get(item.medicineId)!;
    const unitPrice = Number(medicine.price);
    const subtotal = unitPrice * item.qty;
    return {
      medicineId: item.medicineId,
      qty: item.qty,
      unitPrice,
      subtotal,
      medicineName: medicine.name,
      batchNumber: medicine.batchNumber,
    };
  });

  const amount = pricedItems.reduce((sum, item) => sum + item.subtotal, 0);

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        patientId: patient.patientId,
        recordedById,
        type: PaymentType.MEDICINE,
        amount,
        paymentMethod,
        remarks: normalizedRemarks,
        status: PaymentStatus.PAID,
      },
    });

    const paymentItems = await Promise.all(
      pricedItems.map((item) =>
        tx.paymentMedicineItem.create({
          data: {
            paymentId: payment.paymentId,
            medicineId: item.medicineId,
            qty: item.qty,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          },
          include: {
            medicine: {
              select: {
                medicineId: true,
                name: true,
                batchNumber: true,
              },
            },
          },
        }),
      ),
    );

    await Promise.all(
      pricedItems.map((item) =>
        tx.medicine.update({
          where: { medicineId: item.medicineId },
          data: {
            quantity: {
              decrement: item.qty,
            },
          },
        }),
      ),
    );

    const receipt = await tx.receipt.create({
      data: {
        paymentId: payment.paymentId,
        receiptNo: generateReceiptNo(),
        totalAmount: amount,
      },
    });

    return { payment, receipt, paymentItems };
  });

  try {
    await logActivity(recordedById, `walkin_medicine_sale:${result.payment.paymentId}`);
  } catch (_) {}

  return res.status(201).json({
    message: 'Walk-in Medicine Sale Successful',
    payment: result.payment,
    receipt: result.receipt,
    patient,
    items: result.paymentItems,
  });
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
      medicineItems: {
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
