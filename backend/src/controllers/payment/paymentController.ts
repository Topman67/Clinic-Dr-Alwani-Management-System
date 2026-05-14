import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { InventoryStockAction, MedicineApprovalStatus, PaymentMethod, PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { generateReceiptNo } from '../../utils/receipt';
import { logActivity } from '../../utils/audit';
import { createInventoryLog, isExpiredMedicine } from '../medicine/medicineController';
import { clinicPaymentInclude } from '../../services/clinicPayment';

type WalkInMedicineInput = {
  medicineId?: number | string;
  qty?: number | string;
};

const WALKIN_CUSTOMER_NAME = 'Walk-in Customer';
const WALKIN_CUSTOMER_PHONE = 'N/A';
const WALKIN_CUSTOMER_ID_PREFIX = 'WALKIN';

const normalizeSalesPaymentType = (value: unknown): PaymentType | undefined => {
  if (value === PaymentType.CONSULTATION || value === 'CONSULTATION_FEE' || value === 'Consultation Fee') {
    return PaymentType.CONSULTATION;
  }
  if (value === PaymentType.APPOINTMENT || value === 'APPOINTMENT_FEE' || value === 'Appointment Fee') {
    return PaymentType.APPOINTMENT;
  }
  if (value === PaymentType.MEDICINE || value === 'WALK_IN_MEDICINE' || value === 'Walk-in Medicine') {
    return PaymentType.MEDICINE;
  }
  return undefined;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const medicines = await prisma.medicine.findMany({
    where: {
      approvalStatus: MedicineApprovalStatus.APPROVED,
      quantity: { gt: 0 },
      expiryDate: { gte: today },
    },
    select: {
      medicineId: true,
      name: true,
      batchNumber: true,
      category: true,
      brand: true,
      packaging: true,
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
      approvalStatus: MedicineApprovalStatus.APPROVED,
    },
    select: {
      medicineId: true,
      name: true,
      batchNumber: true,
      quantity: true,
      price: true,
      expiryDate: true,
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

    if (isExpiredMedicine(medicine.expiryDate)) {
      return res.status(400).json({ message: `${medicine.name} is expired and cannot be sold.` });
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
        status: PaymentStatus.PENDING_DISPENSE,
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

    const receipt = await createReceiptWithRetry(tx, payment.paymentId, amount);

    return { payment, receipt, paymentItems };
  });

  try {
    await logActivity(recordedById, `walkin_medicine_sale:${result.payment.paymentId}`);
  } catch (_) {}

  return res.status(201).json({
    message: 'Walk-in Medicine Sale Paid - Pending Dispense',
    payment: result.payment,
    receipt: result.receipt,
    patient,
    items: result.paymentItems,
  });
};

const toDateStart = (value: string | undefined) => {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toDateEnd = (value: string | undefined) => {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const dispenseWalkInSale = async (req: Request, res: Response) => {
  const paymentId = Number(req.params.id);
  const performedById = req.user?.userId;

  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ message: 'Invalid sale reference.' });
  }
  if (!performedById) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.payment.findUnique({
        where: { paymentId },
        include: {
          medicineItems: {
            include: {
              medicine: {
                select: {
                  medicineId: true,
                  name: true,
                  batchNumber: true,
                  quantity: true,
                  approvalStatus: true,
                  expiryDate: true,
                },
              },
            },
          },
        },
      });

      if (!sale) throw Object.assign(new Error('Sale not found.'), { statusCode: 404 });
      if (sale.type !== PaymentType.MEDICINE) throw Object.assign(new Error('Only medicine sales can be dispensed.'), { statusCode: 400 });
      if (sale.status === PaymentStatus.DISPENSED) throw Object.assign(new Error('This sale has already been dispensed.'), { statusCode: 409 });
      if (sale.status !== PaymentStatus.PENDING_DISPENSE) throw Object.assign(new Error('Sale is not pending dispense.'), { statusCode: 400 });

      for (const item of sale.medicineItems) {
        if (!item.medicine) throw Object.assign(new Error('Medicine item is no longer available.'), { statusCode: 409 });
        if (isExpiredMedicine(item.medicine.expiryDate)) throw Object.assign(new Error(`${item.medicine.name} is expired and cannot be dispensed.`), { statusCode: 400 });

        const updateResult = await tx.medicine.updateMany({
          where: {
            medicineId: item.medicineId,
            approvalStatus: MedicineApprovalStatus.APPROVED,
            quantity: { gte: item.qty },
          },
          data: {
            quantity: {
              decrement: item.qty,
            },
          },
        });

        if (updateResult.count !== 1) {
          throw Object.assign(new Error(`Insufficient stock for ${item.medicine.name}.`), { statusCode: 409 });
        }

        await createInventoryLog(tx, {
          medicineId: item.medicineId,
          itemName: item.medicine.name,
          batchNumber: item.medicine.batchNumber,
          quantityChange: -item.qty,
          actionType: InventoryStockAction.STOCK_DEDUCTED,
          performedById,
          performedByUsername: req.user?.username,
        });
      }

      return tx.payment.update({
        where: { paymentId },
        data: {
          status: PaymentStatus.DISPENSED,
          dispensedAt: new Date(),
          dispensedById: performedById,
          dispensedByUsername: req.user?.username,
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
                  quantity: true,
                  expiryDate: true,
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
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    try {
      await logActivity(performedById, `dispense_walkin_sale:${paymentId}`);
    } catch (_) {}

    return res.json(result);
  } catch (error: unknown) {
    const httpStatus = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (error instanceof Error && typeof httpStatus === 'number') {
      return res.status(httpStatus).json({ message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return res.status(409).json({ message: 'Dispensing conflicted. Please retry.' });
    }
    throw error;
  }
};

export const recordPayment = async (req: Request, res: Response) => {
  return res.status(410).json({
    message: 'Direct payments have been removed. Use pending clinic payments or walk-in medicine sale.',
  });
};

export const listPendingPayments = async (_req: Request, res: Response) => {
  const payments = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PENDING_PAYMENT,
      type: {
        in: [PaymentType.CONSULTATION, PaymentType.APPOINTMENT],
      },
    },
    include: clinicPaymentInclude,
    orderBy: [{ date: 'asc' }, { paymentId: 'asc' }],
  });

  res.json(payments);
};

export const confirmPendingPayment = async (req: Request, res: Response) => {
  const paymentId = Number(req.params.id);
  const { paymentMethod, remarks } = req.body as {
    paymentMethod?: PaymentMethod;
    remarks?: string;
  };
  const recordedById = req.user?.userId;

  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ message: 'Invalid payment reference.' });
  }

  if (!recordedById) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!isPaymentMethod(paymentMethod)) {
    return res.status(400).json({ message: 'Please select a valid payment method.' });
  }

  const normalizedRemarks = normalizeRemarks(remarks);
  if (normalizedRemarks && normalizedRemarks.length > 500) {
    return res.status(400).json({ message: 'Remarks must be 500 characters or less.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { paymentId },
        include: {
          receipt: true,
          consultation: { select: { consultationId: true, status: true } },
          prescription: { select: { prescriptionId: true, status: true } },
          appointment: { select: { appointmentId: true, status: true } },
        },
      });

      if (!existing) throw Object.assign(new Error('Payment not found.'), { statusCode: 404 });
      if (existing.status === PaymentStatus.PAID) throw Object.assign(new Error('This payment has already been paid.'), { statusCode: 409 });
      if (existing.status !== PaymentStatus.PENDING_PAYMENT) throw Object.assign(new Error('Only pending clinic payments can be confirmed.'), { statusCode: 400 });
      if (existing.type !== PaymentType.CONSULTATION && existing.type !== PaymentType.APPOINTMENT) {
        throw Object.assign(new Error('Only linked clinic payments can be confirmed here.'), { statusCode: 400 });
      }
      if (existing.consultation && existing.consultation.status !== 'COMPLETED') {
        throw Object.assign(new Error('Consultation must be completed before payment.'), { statusCode: 400 });
      }
      if (existing.prescription && existing.prescription.status !== 'DISPENSED') {
        throw Object.assign(new Error('Prescription must be dispensed before payment.'), { statusCode: 400 });
      }
      if (existing.appointment && !existing.consultation && existing.appointment.status !== 'COMPLETED') {
        throw Object.assign(new Error('Appointment must be completed before payment.'), { statusCode: 400 });
      }
      if (existing.receipt) {
        throw Object.assign(new Error('This payment already has a receipt.'), { statusCode: 409 });
      }

      const payment = await tx.payment.update({
        where: { paymentId },
        data: {
          status: PaymentStatus.PAID,
          paymentMethod,
          remarks: normalizedRemarks ?? existing.remarks,
          recordedById,
          date: new Date(),
        },
      });

      const receipt = await createReceiptWithRetry(tx, payment.paymentId, Number(payment.amount));
      const paidPayment = await tx.payment.findUnique({
        where: { paymentId },
        include: clinicPaymentInclude,
      });

      return { payment: paidPayment, receipt };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    try {
      await logActivity(recordedById, `confirm_pending_payment:${paymentId}`);
    } catch (_) {}

    return res.json({
      message: 'Payment Successful',
      payment: result.payment,
      receipt: result.receipt,
    });
  } catch (error: unknown) {
    const httpStatus = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (error instanceof Error && typeof httpStatus === 'number') {
      return res.status(httpStatus).json({ message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return res.status(409).json({ message: 'Payment confirmation conflicted. Please retry.' });
    }
    throw error;
  }
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
        gte: toDateStart(dateFrom),
        lte: toDateEnd(dateTo),
      },
    },
    include: clinicPaymentInclude,
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

  const searchQuery = typeof customerId === 'string' ? customerId.trim() : '';
  const paymentTypeFilter = normalizeSalesPaymentType(type);
  const paymentStatusFilter =
    Object.values(PaymentStatus).includes(status as PaymentStatus)
      ? (status as PaymentStatus)
      : undefined;

  const sales = await prisma.payment.findMany({
    where: {
      type: paymentTypeFilter,
      status: paymentStatusFilter,
      date: {
        gte: toDateStart(dateFrom),
        lte: toDateEnd(dateTo),
      },
      OR: searchQuery
        ? [
            { patient: { is: { name: { contains: searchQuery, mode: 'insensitive' } } } },
            { patient: { is: { icOrPassport: { contains: searchQuery, mode: 'insensitive' } } } },
            { patient: { is: { phone: { contains: searchQuery, mode: 'insensitive' } } } },
            { receipt: { is: { receiptNo: { contains: searchQuery, mode: 'insensitive' } } } },
            { medicineItems: { some: { medicine: { name: { contains: searchQuery, mode: 'insensitive' } } } } },
          ]
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
              quantity: true,
              expiryDate: true,
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
