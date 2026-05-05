import { Request, Response } from 'express';
import { AppointmentStatus, ConsultationStatus, Role, UserStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

const cleanOptionalText = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parsePositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getDefaultDoctorId = async () => {
  const doctor = await prisma.user.findFirst({
    where: {
      role: Role.DOCTOR,
      status: UserStatus.ACTIVE,
    },
    orderBy: { userId: 'asc' },
    select: { userId: true },
  });

  return doctor?.userId ?? null;
};

const consultationInclude = {
  patient: {
    select: {
      patientId: true,
      name: true,
      icOrPassport: true,
      phone: true,
      gender: true,
      dateOfBirth: true,
    },
  },
  appointment: {
    select: {
      appointmentId: true,
      dateTime: true,
      status: true,
      type: true,
    },
  },
  doctor: {
    select: {
      userId: true,
      username: true,
    },
  },
  prescription: {
    select: {
      prescriptionId: true,
      date: true,
    },
  },
};

export const createConsultation = async (req: Request, res: Response) => {
  const patientId = parsePositiveInt(req.body.patientId);
  const appointmentId = req.body.appointmentId === undefined || req.body.appointmentId === null
    ? null
    : parsePositiveInt(req.body.appointmentId);
  const requestedDoctorId = parsePositiveInt(req.body.doctorId);

  if (!patientId) {
    return res.status(400).json({ message: 'Patient is required.' });
  }

  if (req.body.appointmentId !== undefined && req.body.appointmentId !== null && !appointmentId) {
    return res.status(400).json({ message: 'Invalid appointment reference.' });
  }

  const [patient, defaultDoctorId] = await Promise.all([
    prisma.patient.findUnique({ where: { patientId } }),
    getDefaultDoctorId(),
  ]);

  if (!patient) {
    return res.status(404).json({ message: 'Patient record not found.' });
  }

  const doctorId = requestedDoctorId ?? defaultDoctorId;
  if (!doctorId) {
    return res.status(400).json({ message: 'Default doctor account is not available.' });
  }

  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { appointmentId } });
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    if (appointment.patientId !== patientId) {
      return res.status(400).json({ message: 'Appointment does not match selected patient.' });
    }
  }

  const consultation = await prisma.consultation.create({
    data: {
      patientId,
      appointmentId,
      doctorId,
      status: ConsultationStatus.WAITING,
    },
    include: consultationInclude,
  });

  res.status(201).json(consultation);
  try {
    await logActivity(req.user?.userId, `create_consultation:${consultation.consultationId}`);
  } catch (_) {}
};

export const listConsultations = async (req: Request, res: Response) => {
  const { status, query, patientId } = req.query as {
    status?: string;
    query?: string;
    patientId?: string;
  };

  const normalizedStatus = status?.toUpperCase() as ConsultationStatus | undefined;
  if (normalizedStatus && !Object.values(ConsultationStatus).includes(normalizedStatus)) {
    return res.status(400).json({ message: 'Invalid consultation status.' });
  }

  const parsedPatientId = patientId ? parsePositiveInt(patientId) : null;
  if (patientId && !parsedPatientId) {
    return res.status(400).json({ message: 'Invalid patient reference.' });
  }

  const keyword = query?.trim();
  const consultations = await prisma.consultation.findMany({
    where: {
      status: normalizedStatus,
      patientId: parsedPatientId ?? undefined,
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
    include: consultationInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
  });

  res.json(consultations);
};

export const getConsultation = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  if (!consultationId) {
    return res.status(400).json({ message: 'Invalid consultation ID.' });
  }

  const consultation = await prisma.consultation.findUnique({
    where: { consultationId },
    include: consultationInclude,
  });

  if (!consultation) {
    return res.status(404).json({ message: 'Consultation not found.' });
  }

  res.json(consultation);
};

export const startConsultation = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  if (!consultationId) {
    return res.status(400).json({ message: 'Invalid consultation ID.' });
  }

  const existing = await prisma.consultation.findUnique({ where: { consultationId } });
  if (!existing) {
    return res.status(404).json({ message: 'Consultation not found.' });
  }

  if (existing.status === ConsultationStatus.COMPLETED) {
    return res.status(400).json({ message: 'Completed consultations cannot be restarted.' });
  }

  const doctorId = req.user?.userId ?? existing.doctorId;
  const updated = await prisma.consultation.update({
    where: { consultationId },
    data: {
      doctorId,
      status: ConsultationStatus.IN_PROGRESS,
    },
    include: consultationInclude,
  });

  res.json(updated);
  try {
    await logActivity(req.user?.userId, `start_consultation:${consultationId}`);
  } catch (_) {}
};

export const updateConsultation = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  if (!consultationId) {
    return res.status(400).json({ message: 'Invalid consultation ID.' });
  }

  const existing = await prisma.consultation.findUnique({ where: { consultationId } });
  if (!existing) {
    return res.status(404).json({ message: 'Consultation not found.' });
  }

  const requestedStatus = typeof req.body.status === 'string'
    ? (req.body.status.toUpperCase() as ConsultationStatus)
    : undefined;
  if (requestedStatus && !Object.values(ConsultationStatus).includes(requestedStatus)) {
    return res.status(400).json({ message: 'Invalid consultation status.' });
  }

  if (existing.status === ConsultationStatus.WAITING && requestedStatus !== ConsultationStatus.IN_PROGRESS) {
    return res.status(400).json({ message: 'Start consultation before saving clinical notes.' });
  }

  const data = {
    symptoms: cleanOptionalText(req.body.symptoms),
    diagnosis: cleanOptionalText(req.body.diagnosis),
    consultationNotes: cleanOptionalText(req.body.consultationNotes),
    temperature: cleanOptionalText(req.body.temperature),
    bloodPressure: cleanOptionalText(req.body.bloodPressure),
    weight: cleanOptionalText(req.body.weight),
    status: requestedStatus ?? existing.status,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const consultation = await tx.consultation.update({
      where: { consultationId },
      data,
      include: consultationInclude,
    });

    if (consultation.appointmentId && consultation.status === ConsultationStatus.COMPLETED) {
      await tx.appointment.update({
        where: { appointmentId: consultation.appointmentId },
        data: { status: AppointmentStatus.COMPLETED },
      });
    }

    return consultation;
  });

  res.json(updated);
  try {
    await logActivity(req.user?.userId, `update_consultation:${consultationId}:${updated.status}`);
  } catch (_) {}
};
