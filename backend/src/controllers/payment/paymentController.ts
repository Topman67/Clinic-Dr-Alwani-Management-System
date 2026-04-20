import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { PaymentMethod, PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { generateReceiptNo } from '../../utils/receipt';
import { logActivity } from '../../utils/audit';

type WalkInMedicineInput = {
  medicineId?: number | string;
  qty?: number | string;
};

const WALKIN_CUSTOMER_NAME = 'Walk-in Customer';
const WALKIN_CUSTOMER_PHONE = 'N/A';
const WALKIN_CUSTOMER_ID_PREFIX = 'WALKIN';

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

const normalizeWalkInCustomerName = (value: unknown): string => {
  if (typeof value !== 'string') return WALKIN_CUSTOMER_NAME;
  const trimmed = value.trim();
  if (!trimmed) return WALKIN_CUSTOMER_NAME;
  return trimmed.slice(0, 120);
};

const normalizeWalkInCustomerPhone = (value: unknown): string => {
  if (typeof value !== 'string') return WALKIN_CUSTOMER_PHONE;
  const trimmed = value.trim();
  if (!trimmed) return WALKIN_CUSTOMER_PHONE;
  return trimmed.slice(0, 30);
};

const normalizeWalkInCustomerId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  return trimmed.slice(0, 60);
};

const ensureWalkInCustomerScopedId = (value: string | null) => {
  if (!value) return null;
  if (value.startsWith(`${WALKIN_CUSTOMER_ID_PREFIX}-`)) return value;
  return `${WALKIN_CUSTOMER_ID_PREFIX}-${value}`;
};

const buildWalkInCustomerId = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `${WALKIN_CUSTOMER_ID_PREFIX}-${datePart}-${randomPart}`;
};

const generateUniqueWalkInCustomerId = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = buildWalkInCustomerId();
    const existing = await prisma.patient.findUnique({
      where: { icOrPassport: candidate },
      select: { patientId: true },
    });
    if (!existing) return candidate;
  }

  return `${WALKIN_CUSTOMER_ID_PREFIX}-${Date.now()}`;
};

const isReceiptNoUniqueConflict = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.some((field) => String(field) === 'receiptNo');
  }

  return typeof target === 'string' && target.includes('receiptNo');
};

const createReceiptWithRetry = async (
  tx: Prisma.TransactionClient,
  paymentId: number,
  totalAmount: number,
  maxAttempts = 6,
) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await tx.receipt.create({
        data: {
          paymentId,
          receiptNo: generateReceiptNo(),
          totalAmount,
        },
      });
    } catch (error) {
      if (isReceiptNoUniqueConflict(error) && attempt < maxAttempts) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to create receipt number. Please retry.');
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
  const { patientId: patientIdRaw, paymentMethod, remarks, items: itemsRaw, customerName, customerPhone, customerId } = req.body as {
    patientId?: number | string;
    paymentMethod?: PaymentMethod;
    remarks?: string;
    items?: unknown;
    customerName?: string;
    customerPhone?: string;
    customerId?: string;
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

  const normalizedCustomerName = normalizeWalkInCustomerName(customerName);
  const normalizedCustomerPhone = normalizeWalkInCustomerPhone(customerPhone);
  const normalizedCustomerId = normalizeWalkInCustomerId(customerId);
  const resolvedWalkInCustomerId = ensureWalkInCustomerScopedId(normalizedCustomerId) ?? (await generateUniqueWalkInCustomerId());

  if (normalizedCustomerId && normalizedCustomerId.length < 4) {
    return res.status(400).json({ message: 'Customer ID must be at least 4 characters.' });
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
        where: {
          icOrPassport: resolvedWalkInCustomerId,
        },
        update: {
          name: normalizedCustomerName,
          phone: normalizedCustomerPhone,
        },
        create: {
          name: normalizedCustomerName,
          icOrPassport: resolvedWalkInCustomerId,
          phone: normalizedCustomerPhone,
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

    const receipt = await createReceiptWithRetry(tx, payment.paymentId, amount);

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
    const receipt = await createReceiptWithRetry(tx, payment.paymentId, Number(payment.amount));
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
              quantity: true,
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

export const listWalkInSales = async (req: Request, res: Response) => {
  const { dateFrom, dateTo, customerId, type, status } = req.query as {
    dateFrom?: string;
    dateTo?: string;
    customerId?: string;
    type?: string;
    status?: string;
  };

  const customerIdQuery = typeof customerId === 'string' ? customerId.trim() : '';
  const paymentTypeFilter =
    type === PaymentType.CONSULTATION || type === PaymentType.APPOINTMENT || type === PaymentType.MEDICINE
      ? (type as PaymentType)
      : undefined;
  const paymentStatusFilter =
    status === PaymentStatus.PAID || status === PaymentStatus.CANCELLED
      ? (status as PaymentStatus)
      : undefined;

  const sales = await prisma.payment.findMany({
    where: {
      type: paymentTypeFilter,
      status: paymentStatusFilter,
      date: {
        gte: dateFrom ? new Date(dateFrom) : undefined,
        lte: dateTo ? new Date(dateTo) : undefined,
      },
      patient: customerIdQuery
        ? {
            is: {
              icOrPassport: {
                contains: customerIdQuery,
                mode: 'insensitive',
              },
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
          phone: true,
        },
      },
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
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  return res.json(sales);
};
