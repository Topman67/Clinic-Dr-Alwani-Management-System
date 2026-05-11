import { Request, Response } from 'express';
import { AppointmentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';

type Gender = 'MALE' | 'FEMALE' | 'OTHER';
type PatientStatusFilter = 'active' | 'archived' | 'all';

const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const isGender = (value: unknown): value is Gender => value === 'MALE' || value === 'FEMALE' || value === 'OTHER';

const isValidPhone = (phone: string) => /^[0-9+\-()\s]{7,20}$/.test(phone);

const getPatientArchiveStatusWhere = (status: unknown) => {
  const normalized = typeof status === 'string' ? status.toLowerCase() : 'active';
  const filter: PatientStatusFilter = normalized === 'archived' || normalized === 'all' ? normalized : 'active';

  if (filter === 'all') return {};
  return { isActive: filter === 'active' };
};

const getPatientRelationCounts = async (patientId: number) => {
  return prisma.patient.findUnique({
    where: { patientId },
    include: {
      _count: {
        select: {
          prescriptions: true,
          appointments: true,
          payments: true,
          consultations: true,
          medicalCertificates: true,
        },
      },
    },
  });
};

const hasRelatedRecords = (patient: NonNullable<Awaited<ReturnType<typeof getPatientRelationCounts>>>) => {
  return (
    patient._count.prescriptions > 0 ||
    patient._count.appointments > 0 ||
    patient._count.payments > 0 ||
    patient._count.consultations > 0 ||
    patient._count.medicalCertificates > 0
  );
};

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
  const patientId = Number(req.query.patientId);
  const hasPatientId = Number.isInteger(patientId) && patientId > 0;
  const statusWhere = getPatientArchiveStatusWhere(req.query.status);

  const patients = await prisma.patient.findMany({
    where: {
      patientId: hasPatientId ? patientId : undefined,
      ...statusWhere,
      OR: hasPatientId
        ? undefined
        : [
            { name: { contains: query, mode: 'insensitive' } },
            { icOrPassport: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
      NOT: {
        icOrPassport: { startsWith: 'WALKIN-', mode: 'insensitive' },
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          prescriptions: true,
          consultations: true,
          appointments: true,
          payments: true,
          medicalCertificates: true,
        },
      },
      consultations: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          consultationId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      appointments: {
        where: {
          status: { in: [AppointmentStatus.PENDING, AppointmentStatus.ARRIVED] },
        },
        orderBy: { dateTime: 'asc' },
        take: 3,
        select: {
          appointmentId: true,
          status: true,
          dateTime: true,
          updatedAt: true,
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
      consultations: {
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: {
            select: {
              userId: true,
              username: true,
              role: true,
            },
          },
          prescription: {
            select: {
              prescriptionId: true,
              date: true,
            },
          },
          medicalCertificates: {
            orderBy: { createdAt: 'desc' },
            select: {
              medicalCertificateId: true,
              startDate: true,
              days: true,
              returnToWorkDate: true,
              status: true,
            },
          },
        },
      },
      medicalCertificates: {
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: {
            select: {
              userId: true,
              username: true,
              role: true,
            },
          },
          consultation: {
            select: {
              consultationId: true,
              createdAt: true,
              diagnosis: true,
            },
          },
        },
      },
      appointments: {
        orderBy: { dateTime: 'desc' },
        take: 20,
        include: {
          followUpFromConsultation: {
            select: {
              consultationId: true,
              createdAt: true,
              diagnosis: true,
            },
          },
          previousPrescription: {
            select: {
              prescriptionId: true,
              date: true,
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

export const deletePatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid patient id.' });
  }

  const existing = await getPatientRelationCounts(id);

  if (!existing) {
    return res.status(404).json({ message: 'Not found' });
  }

  if (hasRelatedRecords(existing)) {
    return res.status(409).json({
      message: 'Cannot delete patient with existing records.',
    });
  }

  await prisma.patient.delete({ where: { patientId: id } });

  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `delete_patient:${id}`);
  } catch (_) {}

  return res.json({ message: 'Patient deleted successfully.' });
};

export const archivePatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid patient id.' });
  }

  const existing = await prisma.patient.findUnique({ where: { patientId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'Not found' });
  }

  const archivedBy = req.user?.username ?? (req.user?.userId ? String(req.user.userId) : null);
  const patient = await prisma.patient.update({
    where: { patientId: id },
    data: {
      isActive: false,
      archivedAt: new Date(),
      archivedBy,
    },
  });

  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `archive_patient:${id}`);
  } catch (_) {}

  return res.json({ message: 'Patient archived successfully.', patient });
};

export const restorePatient = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid patient id.' });
  }

  const existing = await prisma.patient.findUnique({ where: { patientId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'Not found' });
  }

  const patient = await prisma.patient.update({
    where: { patientId: id },
    data: {
      isActive: true,
      archivedAt: null,
      archivedBy: null,
    },
  });

  try {
    await (await import('../../utils/audit.js')).logActivity(req.user?.userId, `restore_patient:${id}`);
  } catch (_) {}

  return res.json({ message: 'Patient restored successfully.', patient });
};
