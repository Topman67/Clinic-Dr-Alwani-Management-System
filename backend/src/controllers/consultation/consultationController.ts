import { Request, Response } from 'express';
import {
  AppointmentStatus,
  AppointmentType,
  ConsultationStatus,
  MedicalCertificateStatus,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';
import { createPendingPaymentForCompletedConsultationWithoutPrescription } from '../../services/clinicPayment';

const cleanOptionalText = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parsePositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseDateTime = (value: unknown) => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseDateOnly = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

const addUtcDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const parseRangeDate = (value: unknown, endOfDay = false) => {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const dateOnly = parseDateOnly(value);
  const date = dateOnly ?? new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date;
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

const ACTIVE_FOLLOW_UP_STATUSES = [AppointmentStatus.PENDING, AppointmentStatus.ARRIVED];
const ACTIVE_FOLLOW_UP_MESSAGE = 'This consultation already has an active follow-up appointment.';

const createHttpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

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
  followUpAppointments: {
    where: {
      status: { in: ACTIVE_FOLLOW_UP_STATUSES },
    },
    orderBy: { dateTime: 'asc' as const },
    select: {
      appointmentId: true,
      dateTime: true,
      status: true,
      type: true,
      notes: true,
    },
  },
  medicalCertificates: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      medicalCertificateId: true,
      startDate: true,
      days: true,
      returnToWorkDate: true,
      diagnosis: true,
      notes: true,
      status: true,
      createdAt: true,
      doctor: {
        select: {
          username: true,
        },
      },
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

  if (!patient.isActive) {
    return res.status(400).json({ message: 'Archived patients cannot be added to the consultation queue.' });
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
  } else {
    const activeAppointment = await prisma.appointment.findFirst({
      where: {
        patientId,
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.ARRIVED] },
      },
      select: { appointmentId: true },
    });

    if (activeAppointment) {
      return res.status(409).json({
        message: 'Patient already has an active appointment. Use the appointment workflow to start consultation.',
      });
    }
  }

  const activeConsultation = await prisma.consultation.findFirst({
    where: {
      patientId,
      status: { in: [ConsultationStatus.WAITING, ConsultationStatus.IN_PROGRESS] },
    },
    include: consultationInclude,
    orderBy: { createdAt: 'asc' },
  });

  if (activeConsultation) {
    return res.status(409).json({
      message: 'Patient already has an active visit in the consultation queue.',
      consultation: activeConsultation,
    });
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
  const { status, query, patientId, dateFrom, dateTo } = req.query as {
    status?: string;
    query?: string;
    patientId?: string;
    dateFrom?: string;
    dateTo?: string;
  };

  const normalizedStatuses = status
    ?.split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean) as ConsultationStatus[] | undefined;
  if (normalizedStatuses?.some((value) => !Object.values(ConsultationStatus).includes(value))) {
    return res.status(400).json({ message: 'Invalid consultation status.' });
  }

  const parsedDateFrom = parseRangeDate(dateFrom);
  const parsedDateTo = parseRangeDate(dateTo, true);
  if (parsedDateFrom === null || parsedDateTo === null) {
    return res.status(400).json({ message: 'Invalid date range.' });
  }
  if (parsedDateFrom && parsedDateTo && parsedDateFrom > parsedDateTo) {
    return res.status(400).json({ message: 'Date from cannot be later than date to.' });
  }

  const parsedPatientId = patientId ? parsePositiveInt(patientId) : null;
  if (patientId && !parsedPatientId) {
    return res.status(400).json({ message: 'Invalid patient reference.' });
  }

  const keyword = query?.trim();
  const consultations = await prisma.consultation.findMany({
    where: {
      status: normalizedStatuses && normalizedStatuses.length > 0 ? { in: normalizedStatuses } : undefined,
      createdAt: parsedDateFrom || parsedDateTo
        ? {
            gte: parsedDateFrom,
            lte: parsedDateTo,
          }
        : undefined,
      patientId: parsedPatientId ?? undefined,
      patient: keyword
        ? {
            isActive: true,
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { icOrPassport: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : parsedPatientId
          ? undefined
          : { isActive: true },
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

    if (consultation.status === ConsultationStatus.COMPLETED) {
      await createPendingPaymentForCompletedConsultationWithoutPrescription(
        tx,
        consultation.consultationId,
        req.user?.userId ?? consultation.doctorId,
      );
    }

    return consultation;
  });

  res.json(updated);
  try {
    await logActivity(req.user?.userId, `update_consultation:${consultationId}:${updated.status}`);
  } catch (_) {}
};

export const createConsultationFollowUp = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  if (!consultationId) {
    return res.status(400).json({ message: 'Invalid consultation ID.' });
  }

  const parsedDateTime = parseDateTime(req.body.dateTime);
  if (!parsedDateTime) {
    return res.status(400).json({ message: 'Follow-up date and time are required.' });
  }

  const consultation = await prisma.consultation.findUnique({
    where: { consultationId },
    include: {
      patient: true,
      prescription: {
        select: {
          prescriptionId: true,
        },
      },
    },
  });

  if (!consultation) {
    return res.status(404).json({ message: 'Consultation not found.' });
  }

  if (!consultation.patient.isActive) {
    return res.status(400).json({ message: 'Archived patients cannot be used for follow-up appointments.' });
  }

  const doctorId = await getDefaultDoctorId();
  if (!doctorId) {
    return res.status(400).json({ message: 'Default doctor account is not available.' });
  }

  const normalizedNotes = cleanOptionalText(req.body.notes);
  const sourceNote = `Follow-up from consultation #${consultation.consultationId}`;
  const notes = normalizedNotes ? `${sourceNote}: ${normalizedNotes}` : sourceNote;

  try {
    const followUp = await prisma.$transaction(async (tx) => {
      const existingActiveFollowUp = await tx.appointment.findFirst({
        where: {
          followUpFromConsultationId: consultation.consultationId,
          status: { in: ACTIVE_FOLLOW_UP_STATUSES },
        },
        orderBy: { dateTime: 'asc' },
        select: { appointmentId: true },
      });

      if (existingActiveFollowUp) {
        throw createHttpError(409, ACTIVE_FOLLOW_UP_MESSAGE);
      }

      const conflict = await tx.appointment.findFirst({
        where: {
          doctorId,
          dateTime: parsedDateTime,
          status: { in: ACTIVE_FOLLOW_UP_STATUSES },
        },
        select: { appointmentId: true },
      });

      if (conflict) {
        throw createHttpError(409, 'Selected time slot is already booked.');
      }

      return tx.appointment.create({
        data: {
          patientId: consultation.patientId,
          doctorId,
          dateTime: parsedDateTime,
          status: AppointmentStatus.PENDING,
          type: AppointmentType.FOLLOW_UP,
          notes,
          previousPrescriptionId: consultation.prescription?.prescriptionId ?? null,
          followUpFromConsultationId: consultation.consultationId,
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
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    res.status(201).json(followUp);
    try {
      await logActivity(req.user?.userId, `create_consultation_follow_up:${consultationId}:${followUp.appointmentId}`);
    } catch (_) {}
  } catch (error: unknown) {
    const httpStatus = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (error instanceof Error && typeof httpStatus === 'number') {
      return res.status(httpStatus).json({ message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return res.status(409).json({ message: ACTIVE_FOLLOW_UP_MESSAGE });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: ACTIVE_FOLLOW_UP_MESSAGE });
    }
    throw error;
  }
};

export const createConsultationMedicalCertificate = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  if (!consultationId) {
    return res.status(400).json({ message: 'Invalid consultation ID.' });
  }

  const startDate = parseDateOnly(req.body.startDate);
  if (!startDate) {
    return res.status(400).json({ message: 'MC start date is required.' });
  }

  const days = parsePositiveInt(req.body.days);
  if (!days || days > 365) {
    return res.status(400).json({ message: 'Number of MC days must be between 1 and 365.' });
  }

  const diagnosis = typeof req.body.diagnosis === 'string' ? req.body.diagnosis.trim() : '';
  if (diagnosis.length < 2) {
    return res.status(400).json({ message: 'Diagnosis / reason is required.' });
  }

  const requestedStatus = typeof req.body.status === 'string'
    ? (req.body.status.toUpperCase() as MedicalCertificateStatus)
    : MedicalCertificateStatus.ISSUED;
  if (!Object.values(MedicalCertificateStatus).includes(requestedStatus)) {
    return res.status(400).json({ message: 'Invalid MC status.' });
  }

  if (requestedStatus === MedicalCertificateStatus.CANCELLED) {
    return res.status(400).json({ message: 'New MC cannot be created as cancelled.' });
  }

  const consultation = await prisma.consultation.findUnique({
    where: { consultationId },
    include: {
      patient: true,
    },
  });

  if (!consultation) {
    return res.status(404).json({ message: 'Consultation not found.' });
  }

  if (consultation.status === ConsultationStatus.WAITING) {
    return res.status(400).json({ message: 'Start consultation before generating MC.' });
  }

  if (!consultation.patient.isActive) {
    return res.status(400).json({ message: 'Archived patients cannot be issued medical certificates.' });
  }

  const existingMedicalCertificate = await prisma.medicalCertificate.findFirst({
    where: { consultationId: consultation.consultationId },
    select: { medicalCertificateId: true },
  });

  if (existingMedicalCertificate) {
    return res.status(409).json({
      message: 'This consultation already has an MC. Please edit or remove the existing MC.',
      medicalCertificateId: existingMedicalCertificate.medicalCertificateId,
    });
  }

  const doctorId = req.user?.userId ?? consultation.doctorId;
  const returnToWorkDate = addUtcDays(startDate, days);
  const notes = cleanOptionalText(req.body.notes);

  try {
    const medicalCertificate = await prisma.medicalCertificate.create({
      data: {
        patientId: consultation.patientId,
        consultationId: consultation.consultationId,
        doctorId,
        startDate,
        days,
        returnToWorkDate,
        diagnosis,
        notes,
        status: requestedStatus,
      },
      include: {
        patient: {
          select: {
            patientId: true,
            name: true,
            icOrPassport: true,
          },
        },
        consultation: {
          select: {
            consultationId: true,
            createdAt: true,
          },
        },
        doctor: {
          select: {
            username: true,
          },
        },
      },
    });

    res.status(201).json(medicalCertificate);
    try {
      await logActivity(req.user?.userId, `create_medical_certificate:${consultationId}:${medicalCertificate.medicalCertificateId}`);
    } catch (_) {}
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return res.status(400).json({ message: 'Unable to link MC to consultation.' });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: 'This consultation already has an MC. Please edit or remove the existing MC.' });
    }
    throw error;
  }
};

export const updateConsultationMedicalCertificate = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  const medicalCertificateId = parsePositiveInt(req.params.mcId);
  if (!consultationId || !medicalCertificateId) {
    return res.status(400).json({ message: 'Invalid MC reference.' });
  }

  const startDate = parseDateOnly(req.body.startDate);
  if (!startDate) {
    return res.status(400).json({ message: 'MC start date is required.' });
  }

  const days = parsePositiveInt(req.body.days);
  if (!days || days > 365) {
    return res.status(400).json({ message: 'Number of MC days must be between 1 and 365.' });
  }

  const diagnosis = typeof req.body.diagnosis === 'string' ? req.body.diagnosis.trim() : '';
  if (diagnosis.length < 2) {
    return res.status(400).json({ message: 'Diagnosis / reason is required.' });
  }

  const requestedStatus = typeof req.body.status === 'string'
    ? (req.body.status.toUpperCase() as MedicalCertificateStatus)
    : MedicalCertificateStatus.ISSUED;
  if (!Object.values(MedicalCertificateStatus).includes(requestedStatus)) {
    return res.status(400).json({ message: 'Invalid MC status.' });
  }

  const existing = await prisma.medicalCertificate.findUnique({
    where: { medicalCertificateId },
    select: { consultationId: true },
  });

  if (!existing || existing.consultationId !== consultationId) {
    return res.status(404).json({ message: 'Medical certificate not found.' });
  }

  const updated = await prisma.medicalCertificate.update({
    where: { medicalCertificateId },
    data: {
      startDate,
      days,
      returnToWorkDate: addUtcDays(startDate, days),
      diagnosis,
      notes: cleanOptionalText(req.body.notes),
      status: requestedStatus,
    },
    include: {
      doctor: {
        select: {
          username: true,
        },
      },
    },
  });

  res.json(updated);
  try {
    await logActivity(req.user?.userId, `update_medical_certificate:${consultationId}:${medicalCertificateId}`);
  } catch (_) {}
};

export const deleteConsultationMedicalCertificate = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  const medicalCertificateId = parsePositiveInt(req.params.mcId);
  if (!consultationId || !medicalCertificateId) {
    return res.status(400).json({ message: 'Invalid MC reference.' });
  }

  const existing = await prisma.medicalCertificate.findUnique({
    where: { medicalCertificateId },
    select: { consultationId: true },
  });

  if (!existing || existing.consultationId !== consultationId) {
    return res.status(404).json({ message: 'Medical certificate not found.' });
  }

  await prisma.medicalCertificate.delete({ where: { medicalCertificateId } });
  res.json({ message: 'Medical certificate removed.' });
  try {
    await logActivity(req.user?.userId, `delete_medical_certificate:${consultationId}:${medicalCertificateId}`);
  } catch (_) {}
};

export const updateConsultationMedicalCertificateStatus = async (req: Request, res: Response) => {
  const consultationId = parsePositiveInt(req.params.id);
  const medicalCertificateId = parsePositiveInt(req.params.mcId);
  if (!consultationId || !medicalCertificateId) {
    return res.status(400).json({ message: 'Invalid MC reference.' });
  }

  const requestedStatus = typeof req.body.status === 'string'
    ? (req.body.status.toUpperCase() as MedicalCertificateStatus)
    : undefined;
  if (!requestedStatus || !Object.values(MedicalCertificateStatus).includes(requestedStatus)) {
    return res.status(400).json({ message: 'Invalid MC status.' });
  }

  const existing = await prisma.medicalCertificate.findUnique({
    where: { medicalCertificateId },
    select: {
      consultationId: true,
      status: true,
    },
  });

  if (!existing || existing.consultationId !== consultationId) {
    return res.status(404).json({ message: 'Medical certificate not found.' });
  }

  if (existing.status === MedicalCertificateStatus.CANCELLED) {
    return res.status(400).json({ message: 'Cancelled MC cannot be updated.' });
  }

  const updated = await prisma.medicalCertificate.update({
    where: { medicalCertificateId },
    data: { status: requestedStatus },
    include: {
      doctor: {
        select: {
          username: true,
        },
      },
    },
  });

  res.json(updated);
  try {
    await logActivity(req.user?.userId, `update_medical_certificate_status:${consultationId}:${medicalCertificateId}:${requestedStatus}`);
  } catch (_) {}
};
