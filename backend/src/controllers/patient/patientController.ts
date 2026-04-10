import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';

type Gender = 'MALE' | 'FEMALE' | 'OTHER';

const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const isGender = (value: unknown): value is Gender => value === 'MALE' || value === 'FEMALE' || value === 'OTHER';

const isValidPhone = (phone: string) => /^[0-9+\-()\s]{7,20}$/.test(phone);

const validatePatientPayload = (payload: Record<string, unknown>) => {
  const name = normalize(payload.name);
  const icOrPassport = normalize(payload.icOrPassport);
  const phone = normalize(payload.phone);
  const address = normalize(payload.address);
  const genderRaw = payload.gender;
  const dateOfBirthRaw = normalize(payload.dateOfBirth);

  if (!name || name.length < 2) return { error: 'Name must be at least 2 characters.' };
  if (!icOrPassport || icOrPassport.length < 4) return { error: 'IC/ID must be at least 4 characters.' };
  if (!phone || !isValidPhone(phone)) return { error: 'Phone number format is invalid.' };
  if (!address || address.length < 5) return { error: 'Address must be at least 5 characters.' };
  if (!isGender(genderRaw)) return { error: 'Gender is required.' };

  const dateOfBirth = new Date(dateOfBirthRaw);
  if (!dateOfBirthRaw || Number.isNaN(dateOfBirth.getTime())) {
    return { error: 'Date of birth is invalid.' };
  }

  if (dateOfBirth.getTime() > Date.now()) {
    return { error: 'Date of birth cannot be in the future.' };
  }

  return {
    data: {
      name,
      icOrPassport,
      phone,
      address,
      gender: genderRaw,
      dateOfBirth,
    },
  };
};

export const createPatient = async (req: Request, res: Response) => {
  const parsed = validatePatientPayload(req.body as Record<string, unknown>);
  if ('error' in parsed) {
    return res.status(400).json({ message: parsed.error });
  }

  const duplicate = await prisma.patient.findFirst({
    where: {
      OR: [{ icOrPassport: parsed.data.icOrPassport }, { phone: parsed.data.phone }],
    },
  });

  if (duplicate) {
    return res.status(409).json({ message: 'Patient already exists.' });
  }

  const patient = await prisma.patient.create({ data: parsed.data });
  // audit
  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `create_patient:${patient.patientId}`);
  } catch (_) {}

  res.status(201).json(patient);
};

export const listPatients = async (req: Request, res: Response) => {
  const query = (req.query.query as string) || '';
  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { icOrPassport: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          prescriptions: true,
          payments: true,
        },
      },
    },
  });
  res.json(patients);
};

export const getPatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const patient = await prisma.patient.findUnique({
    where: { patientId: id },
    include: {
      prescriptions: {
        orderBy: { date: 'desc' },
        include: {
          doctor: {
            select: {
              userId: true,
              username: true,
              role: true,
            },
          },
          items: {
            include: {
              medicine: {
                select: {
                  medicineId: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      payments: {
        orderBy: { date: 'desc' },
        include: {
          recordedBy: {
            select: {
              userId: true,
              username: true,
              role: true,
            },
          },
          receipt: true,
        },
      },
    },
  });
  if (!patient) return res.status(404).json({ message: 'Not found' });
  res.json(patient);
};

export const updatePatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = validatePatientPayload(req.body as Record<string, unknown>);
  if ('error' in parsed) {
    return res.status(400).json({ message: parsed.error });
  }

  const existing = await prisma.patient.findUnique({ where: { patientId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'Not found' });
  }

  const duplicate = await prisma.patient.findFirst({
    where: {
      patientId: { not: id },
      OR: [{ icOrPassport: parsed.data.icOrPassport }, { phone: parsed.data.phone }],
    },
  });

  if (duplicate) {
    return res.status(409).json({ message: 'Patient already exists.' });
  }

  const patient = await prisma.patient.update({ where: { patientId: id }, data: parsed.data });
  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `update_patient:${patient.patientId}`);
  } catch (_) {}
  res.json(patient);
};
