/// <reference types="node" />
import { PrismaClient, Role, UserStatus, PaymentType, PaymentStatus, Gender } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  const doctor = await prisma.user.upsert({
    where: { username: 'doctor' },
    update: {},
    create: {
      username: 'doctor',
      passwordHash,
      role: Role.DOCTOR,
      status: UserStatus.ACTIVE,
    },
  });

  const receptionist = await prisma.user.upsert({
    where: { username: 'reception' },
    update: {},
    create: {
      username: 'reception',
      passwordHash,
      role: Role.RECEPTIONIST,
      status: UserStatus.ACTIVE,
    },
  });

  const pharmacist = await prisma.user.upsert({
    where: { username: 'pharma' },
    update: {},
    create: {
      username: 'pharma',
      passwordHash,
      role: Role.PHARMACIST,
      status: UserStatus.ACTIVE,
    },
  });

  const patient = await prisma.patient.upsert({
    where: { icOrPassport: 'P-0001' },
    update: {},
    create: {
      name: 'John Doe',
      icOrPassport: 'P-0001',
      phone: '0123456789',
      address: 'No. 10, Jalan Klinik, Kuala Lumpur',
      gender: Gender.MALE,
      dateOfBirth: new Date('1990-05-15'),
    },
  });

  const med = await prisma.medicine.upsert({
    where: { name_batchNumber: { name: 'Paracetamol', batchNumber: 'BATCH-001' } },
    update: {},
    create: {
      name: 'Paracetamol',
      batchNumber: 'BATCH-001',
      quantity: 100,
      expiryDate: new Date(new Date().setMonth(new Date().getMonth() + 6)),
      price: 12.5,
    },
  });

  const prescription = await prisma.prescription.create({
    data: {
      patientId: patient.patientId,
      doctorId: doctor.userId,
      notes: 'Take after meals',
      items: {
        create: [
          {
            medicineId: med.medicineId,
            dosage: '500mg',
            frequency: '3 times/day',
            duration: '5 days',
            qty: 15,
          },
        ],
      },
    },
    include: { items: true },
  });

  const payment = await prisma.payment.create({
    data: {
      patientId: patient.patientId,
      recordedById: receptionist.userId,
      type: PaymentType.CONSULTATION,
      amount: 50,
      status: PaymentStatus.PAID,
    },
  });

  await prisma.receipt.create({
    data: {
      paymentId: payment.paymentId,
      receiptNo: `RCP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-0001`,
      totalAmount: payment.amount,
    },
  });

  console.log('Seed data created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
