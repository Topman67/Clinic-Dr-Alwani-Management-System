import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ConsultationStatus,
  MedicineApprovalStatus,
  PaymentMethod,
  PaymentStatus,
  PrescriptionStatus,
  Role,
  StockUnit,
} from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { createPrescription, dispensePrescription, rejectPrescription, verifyPrescription } from '../controllers/prescription/prescriptionController';
import { confirmPendingPayment } from '../controllers/payment/paymentController';

type TestUser = { userId: number; username: string; role: Role };
type MockResponse = Response & {
  statusCodeValue: number;
  body: unknown;
};

const testPrefix = `workflow-test-${Date.now()}`;
let sequence = 0;
let createdUserIds: number[] = [];
let createdPatientIds: number[] = [];
let createdMedicineIds: number[] = [];
let createdConsultationIds: number[] = [];

const doctor: { current?: TestUser } = {};
const pharmacist: { current?: TestUser } = {};
const receptionist: { current?: TestUser } = {};

const createMockResponse = () => {
  const response = {
    statusCodeValue: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCodeValue = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return response as MockResponse;
};

const invoke = async (
  handler: (req: Request, res: Response) => Promise<unknown>,
  options: { params?: Record<string, string>; body?: unknown; user?: TestUser } = {},
) => {
  const req = {
    params: options.params ?? {},
    body: options.body ?? {},
    user: options.user,
  } as Request;
  const res = createMockResponse();

  await handler(req, res);
  return res;
};

const nextLabel = (label: string) => `${testPrefix}-${label}-${++sequence}`;

const createStaffUser = async (role: Role): Promise<TestUser> => {
  const user = await prisma.user.create({
    data: {
      username: nextLabel(role.toLowerCase()),
      passwordHash: 'test-password-hash',
      role,
    },
    select: {
      userId: true,
      username: true,
      role: true,
    },
  });
  createdUserIds.push(user.userId);
  return user;
};

const createCompletedConsultation = async () => {
  const patient = await prisma.patient.create({
    data: {
      name: nextLabel('patient'),
      icOrPassport: nextLabel('ic'),
      phone: '0123456789',
    },
  });
  createdPatientIds.push(patient.patientId);

  const consultation = await prisma.consultation.create({
    data: {
      patientId: patient.patientId,
      doctorId: doctor.current!.userId,
      symptoms: 'Fever',
      diagnosis: 'Viral fever',
      status: ConsultationStatus.COMPLETED,
    },
  });
  createdConsultationIds.push(consultation.consultationId);

  return { patient, consultation };
};

const createMedicine = async (
  overrides: Partial<{
    quantity: number;
    expiryDate: Date;
    approvalStatus: MedicineApprovalStatus;
    isActive: boolean;
  }> = {},
) => {
  const medicine = await prisma.medicine.create({
    data: {
      name: nextLabel('medicine'),
      batchNumber: nextLabel('batch'),
      stockUnit: StockUnit.tablet,
      quantity: overrides.quantity ?? 20,
      expiryDate: overrides.expiryDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      price: 2.5,
      approvalStatus: overrides.approvalStatus ?? MedicineApprovalStatus.APPROVED,
      isActive: overrides.isActive ?? true,
    },
  });
  createdMedicineIds.push(medicine.medicineId);
  return medicine;
};

const prescriptionPayload = (input: {
  patientId: number;
  consultationId: number;
  medicineId: number;
  qty?: number;
}) => ({
  patientId: input.patientId,
  doctorId: doctor.current!.userId,
  consultationId: input.consultationId,
  notes: 'Test prescription',
  items: [
    {
      medicineId: input.medicineId,
      dosage: '1 tablet',
      frequency: 'Twice daily',
      duration: '3 days',
      qty: input.qty ?? 2,
    },
  ],
});

const createValidPrescription = async () => {
  const { patient, consultation } = await createCompletedConsultation();
  const medicine = await createMedicine();
  const response = await invoke(createPrescription, {
    user: doctor.current,
    body: prescriptionPayload({
      patientId: patient.patientId,
      consultationId: consultation.consultationId,
      medicineId: medicine.medicineId,
    }),
  });

  assert.equal(response.statusCodeValue, 201);
  const body = response.body as { prescriptionId: number };
  return { patient, consultation, medicine, prescriptionId: body.prescriptionId };
};

const cleanupCreatedData = async () => {
  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        { patientId: { in: createdPatientIds } },
        { consultationId: { in: createdConsultationIds } },
        { prescription: { is: { consultationId: { in: createdConsultationIds } } } },
      ],
    },
    select: { paymentId: true },
  });
  const paymentIds = payments.map((payment) => payment.paymentId);

  await prisma.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.paymentMedicineItem.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.prescriptionMedicine.deleteMany({
    where: {
      OR: [
        { prescription: { consultationId: { in: createdConsultationIds } } },
        { medicineId: { in: createdMedicineIds } },
      ],
    },
  });
  await prisma.prescription.deleteMany({ where: { consultationId: { in: createdConsultationIds } } });
  await prisma.inventoryStockLog.deleteMany({ where: { medicineId: { in: createdMedicineIds } } });
  await prisma.consultation.deleteMany({ where: { consultationId: { in: createdConsultationIds } } });
  await prisma.medicine.deleteMany({ where: { medicineId: { in: createdMedicineIds } } });
  await prisma.patient.deleteMany({ where: { patientId: { in: createdPatientIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { userId: { in: createdUserIds } } });

  createdUserIds = [];
  createdPatientIds = [];
  createdMedicineIds = [];
  createdConsultationIds = [];
};

describe('critical clinic consultation-prescription-payment workflow', () => {
  beforeEach(async () => {
    doctor.current = await createStaffUser(Role.DOCTOR);
    pharmacist.current = await createStaffUser(Role.PHARMACIST);
    receptionist.current = await createStaffUser(Role.RECEPTIONIST);
  });

  after(async () => {
    await cleanupCreatedData();
    await prisma.$disconnect();
  });

  it('creates pending payment only after prescription is dispensed and marks it paid only after receptionist confirms', async () => {
    const { consultation, prescriptionId } = await createValidPrescription();

    const paymentsAfterCreate = await prisma.payment.findMany({
      where: { consultationId: consultation.consultationId },
    });
    assert.equal(paymentsAfterCreate.some((payment) => payment.status === PaymentStatus.PAID), false);
    assert.equal(paymentsAfterCreate.length, 0);

    const verifyResponse = await invoke(verifyPrescription, {
      user: pharmacist.current,
      params: { id: String(prescriptionId) },
    });
    assert.equal(verifyResponse.statusCodeValue, 200);
    assert.equal((verifyResponse.body as { status: PrescriptionStatus }).status, PrescriptionStatus.VERIFIED);

    const dispenseResponse = await invoke(dispensePrescription, {
      user: pharmacist.current,
      params: { id: String(prescriptionId) },
    });
    assert.equal(dispenseResponse.statusCodeValue, 200);
    assert.equal((dispenseResponse.body as { status: PrescriptionStatus }).status, PrescriptionStatus.DISPENSED);

    const pendingPayment = await prisma.payment.findFirstOrThrow({
      where: {
        consultationId: consultation.consultationId,
        prescriptionId,
      },
      include: { medicineItems: true },
    });
    assert.equal(pendingPayment.status, PaymentStatus.PENDING_PAYMENT);
    assert.equal(pendingPayment.medicineItems.length, 1);

    const confirmResponse = await invoke(confirmPendingPayment, {
      user: receptionist.current,
      params: { id: String(pendingPayment.paymentId) },
      body: {
        paymentMethod: PaymentMethod.CASH,
        consultationFee: 20,
      },
    });
    assert.equal(confirmResponse.statusCodeValue, 200);

    const finalPayment = await prisma.payment.findUniqueOrThrow({
      where: { paymentId: pendingPayment.paymentId },
      include: { receipt: true },
    });
    assert.equal(finalPayment.status, PaymentStatus.PAID);
    assert.ok(finalPayment.receipt);
  });

  it('prevents duplicate prescriptions for the same consultation', async () => {
    const { patient, consultation, medicine } = await createValidPrescription();
    const secondMedicine = await createMedicine();

    const duplicateResponse = await invoke(createPrescription, {
      user: doctor.current,
      body: prescriptionPayload({
        patientId: patient.patientId,
        consultationId: consultation.consultationId,
        medicineId: secondMedicine.medicineId,
      }),
    });

    assert.equal(duplicateResponse.statusCodeValue, 409);
    assert.match((duplicateResponse.body as { message: string }).message, /already has a prescription/i);
    assert.equal(medicine.quantity, 20);
  });

  it('prevents dispensing before pharmacist verification', async () => {
    const { prescriptionId } = await createValidPrescription();

    const response = await invoke(dispensePrescription, {
      user: pharmacist.current,
      params: { id: String(prescriptionId) },
    });

    assert.equal(response.statusCodeValue, 400);
    assert.match((response.body as { message: string }).message, /verify prescription before dispensing/i);
  });

  it('prevents prescription creation or modification after payment is completed', async () => {
    const { consultation, prescriptionId } = await createValidPrescription();

    await invoke(verifyPrescription, {
      user: pharmacist.current,
      params: { id: String(prescriptionId) },
    });
    await invoke(dispensePrescription, {
      user: pharmacist.current,
      params: { id: String(prescriptionId) },
    });
    const pendingPayment = await prisma.payment.findFirstOrThrow({
      where: {
        consultationId: consultation.consultationId,
        prescriptionId,
      },
    });
    await invoke(confirmPendingPayment, {
      user: receptionist.current,
      params: { id: String(pendingPayment.paymentId) },
      body: {
        paymentMethod: PaymentMethod.CASH,
        consultationFee: 20,
      },
    });

    const modifyResponse = await invoke(rejectPrescription, {
      user: pharmacist.current,
      params: { id: String(prescriptionId) },
    });
    assert.equal(modifyResponse.statusCodeValue, 409);
    assert.match((modifyResponse.body as { message: string }).message, /already been paid/i);

    const { patient: paidPatient, consultation: paidConsultation } = await createCompletedConsultation();
    const medicine = await createMedicine();
    await prisma.payment.create({
      data: {
        patientId: paidPatient.patientId,
        recordedById: receptionist.current!.userId,
        type: 'CONSULTATION',
        amount: 20,
        status: PaymentStatus.PAID,
        consultationId: paidConsultation.consultationId,
        paymentMethod: PaymentMethod.CASH,
      },
    });

    const createAfterPaidResponse = await invoke(createPrescription, {
      user: doctor.current,
      body: prescriptionPayload({
        patientId: paidPatient.patientId,
        consultationId: paidConsultation.consultationId,
        medicineId: medicine.medicineId,
      }),
    });

    assert.equal(createAfterPaidResponse.statusCodeValue, 409);
    assert.match((createAfterPaidResponse.body as { message: string }).message, /already been paid/i);
  });

  it('prevents prescribing expired, inactive, unapproved, or out-of-stock medicine', async () => {
    const cases = [
      {
        name: 'expired',
        medicine: { expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        message: /expired/i,
      },
      {
        name: 'inactive',
        medicine: { isActive: false },
        message: /archived/i,
      },
      {
        name: 'not approved',
        medicine: { approvalStatus: MedicineApprovalStatus.PENDING },
        message: /not approved/i,
      },
      {
        name: 'out of stock',
        medicine: { quantity: 0 },
        message: /insufficient stock/i,
      },
    ];

    for (const invalidCase of cases) {
      const { patient, consultation } = await createCompletedConsultation();
      const medicine = await createMedicine(invalidCase.medicine);

      const response = await invoke(createPrescription, {
        user: doctor.current,
        body: prescriptionPayload({
          patientId: patient.patientId,
          consultationId: consultation.consultationId,
          medicineId: medicine.medicineId,
        }),
      });

      assert.equal(response.statusCodeValue, 400, invalidCase.name);
      assert.match((response.body as { message: string }).message, invalidCase.message, invalidCase.name);
    }
  });
});
