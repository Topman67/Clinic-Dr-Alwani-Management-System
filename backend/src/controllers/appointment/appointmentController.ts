import { Request, Response } from 'express';
import { AppointmentStatus, AppointmentType, Role, UserStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/audit';

const isNonEmptyText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

const parseDateTime = (value: unknown) => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getDayRange = (isoDate: string) => {
  const start = new Date(`${isoDate}T00:00:00.000`);
  const end = new Date(`${isoDate}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
};

const getDefaultDoctorId = async () => {
  const doctor = await prisma.user.findFirst({
    where: { role: Role.DOCTOR, status: UserStatus.ACTIVE },
    orderBy: { userId: 'asc' },
    select: { userId: true },
  });

  return doctor?.userId ?? null;
};

const hasSlotConflict = async (doctorId: number, dateTime: Date, excludeAppointmentId?: number) => {
  const existing = await prisma.appointment.findFirst({
    where: {
      doctorId,
      dateTime,
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.ARRIVED] },
      appointmentId: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
    },
    select: { appointmentId: true },
  });

  return Boolean(existing);
};

const canTransitionTo = (from: AppointmentStatus, to: AppointmentStatus) => {
  if (from === to) return true;

  const allowed: Record<AppointmentStatus, AppointmentStatus[]> = {
    PENDING: [AppointmentStatus.ARRIVED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
    ARRIVED: [AppointmentStatus.COMPLETED],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };

  return allowed[from].includes(to);
};

export const listAppointments = async (req: Request, res: Response) => {
  const { date, status, type, query } = req.query as {
    date?: string;
    status?: string;
    type?: string;
    query?: string;
  };

  const dayRange = date ? getDayRange(date) : null;
  if (date && !dayRange) {
    return res.status(400).json({ message: 'Invalid date filter.' });
  }

  const normalizedStatus = status?.toUpperCase() as AppointmentStatus | undefined;
  if (normalizedStatus && !Object.values(AppointmentStatus).includes(normalizedStatus)) {
    return res.status(400).json({ message: 'Invalid appointment status.' });
  }

  const normalizedType = type?.toUpperCase() as AppointmentType | undefined;
  if (normalizedType && !Object.values(AppointmentType).includes(normalizedType)) {
    return res.status(400).json({ message: 'Invalid appointment type.' });
  }

  const keyword = query?.trim();

  const appointments = await prisma.appointment.findMany({
    where: {
      dateTime: dayRange
        ? {
            gte: dayRange.start,
            lte: dayRange.end,
          }
        : undefined,
      status: normalizedStatus,
      type: normalizedType,
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
      patient: {
        select: {
          patientId: true,
          name: true,
          icOrPassport: true,
          phone: true,
        },
      },
      doctor: {
        select: {
          userId: true,
          username: true,
        },
      },
      previousPrescription: {
        select: {
          prescriptionId: true,
          date: true,
        },
      },
    },
    orderBy: [{ dateTime: 'asc' }, { appointmentId: 'asc' }],
  });

  res.json(appointments);
};

export const createAppointment = async (req: Request, res: Response) => {
  const { patientId, dateTime, notes } = req.body as {
    patientId?: number;
    dateTime?: string;
    notes?: string;
  };

  const targetPatientId = Number(patientId);
  if (!Number.isInteger(targetPatientId) || targetPatientId <= 0) {
    return res.status(400).json({ message: 'Patient is required.' });
  }

  const normalizedNotesRaw = typeof notes === 'string' ? notes.trim() : '';
  const normalizedNotes = normalizedNotesRaw.length > 0 ? normalizedNotesRaw : undefined;

  const parsedDateTime = parseDateTime(dateTime);
  if (!parsedDateTime) {
    return res.status(400).json({ message: 'Date and time are required.' });
  }

  const [patient, doctorId] = await Promise.all([
    prisma.patient.findUnique({ where: { patientId: targetPatientId } }),
    getDefaultDoctorId(),
  ]);

  if (!patient) {
    return res.status(404).json({ message: 'Patient record not found.' });
  }

  if (!doctorId) {
    return res.status(400).json({ message: 'Default doctor account is not available.' });
  }

  const conflict = await hasSlotConflict(doctorId, parsedDateTime);
  if (conflict) {
    return res.status(409).json({ message: 'Selected time slot is already booked.' });
  }

  const appointment = await prisma.appointment.create({
    data: {
  patientId: targetPatientId,
      doctorId,
      dateTime: parsedDateTime,
      status: AppointmentStatus.PENDING,
      type: AppointmentType.NEW,
  notes: normalizedNotes,
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

  res.status(201).json(appointment);
  try {
    await logActivity(req.user?.userId, `create_appointment:${appointment.appointmentId}`);
  } catch (_) {}
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
  const appointmentId = Number(req.params.id);
  const { status } = req.body as { status?: string };

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment ID.' });
  }

  const normalizedStatus = status?.toUpperCase() as AppointmentStatus | undefined;
  if (!normalizedStatus || !Object.values(AppointmentStatus).includes(normalizedStatus)) {
    return res.status(400).json({ message: 'Invalid appointment status.' });
  }

  const existing = await prisma.appointment.findUnique({ where: { appointmentId } });
  if (!existing) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }

  if (!canTransitionTo(existing.status, normalizedStatus)) {
    return res.status(400).json({ message: `Cannot change status from ${existing.status} to ${normalizedStatus}.` });
  }

  const updated = await prisma.appointment.update({
    where: { appointmentId },
    data: { status: normalizedStatus },
  });

  res.json(updated);
  try {
    await logActivity(req.user?.userId, `update_appointment_status:${appointmentId}:${normalizedStatus}`);
  } catch (_) {}
};

export const startConsultation = async (req: Request, res: Response) => {
  const appointmentId = Number(req.params.id);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment ID.' });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
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

  if (!appointment) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }

  if (appointment.status !== AppointmentStatus.ARRIVED) {
    return res.status(400).json({ message: 'Appointment must be marked as ARRIVED before consultation.' });
  }

  res.json({
    appointmentId: appointment.appointmentId,
    patient: appointment.patient,
    openPrescriptionWith: {
      patientId: appointment.patientId,
      appointmentId: appointment.appointmentId,
    },
  });
};

export const createFollowUpAppointment = async (req: Request, res: Response) => {
  const sourceAppointmentId = Number(req.params.id);
  const { dateTime, notes, previousPrescriptionId } = req.body as {
    dateTime?: string;
    notes?: string;
    previousPrescriptionId?: number;
  };

  if (!Number.isInteger(sourceAppointmentId) || sourceAppointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment ID.' });
  }

  const parsedDateTime = parseDateTime(dateTime);
  if (!parsedDateTime) {
    return res.status(400).json({ message: 'Date and time are required.' });
  }
  const normalizedNotesRaw = typeof notes === 'string' ? notes.trim() : '';
  const normalizedNotes = normalizedNotesRaw.length > 0 ? normalizedNotesRaw : undefined;

  const source = await prisma.appointment.findUnique({ where: { appointmentId: sourceAppointmentId } });
  if (!source) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }

  const doctorId = await getDefaultDoctorId();
  if (!doctorId) {
    return res.status(400).json({ message: 'Default doctor account is not available.' });
  }

  const conflict = await hasSlotConflict(doctorId, parsedDateTime);
  if (conflict) {
    return res.status(409).json({ message: 'Selected time slot is already booked.' });
  }

  if (previousPrescriptionId !== undefined) {
    if (!Number.isInteger(previousPrescriptionId) || previousPrescriptionId <= 0) {
      return res.status(400).json({ message: 'Invalid previous prescription reference.' });
    }

    const previousPrescription = await prisma.prescription.findUnique({ where: { prescriptionId: previousPrescriptionId } });
    if (!previousPrescription || previousPrescription.patientId !== source.patientId) {
      return res.status(400).json({ message: 'Previous prescription does not belong to this patient.' });
    }
  }

  const followUp = await prisma.appointment.create({
    data: {
      patientId: source.patientId,
      doctorId,
      dateTime: parsedDateTime,
  notes: normalizedNotes,
      status: AppointmentStatus.PENDING,
      type: AppointmentType.FOLLOW_UP,
      previousPrescriptionId: previousPrescriptionId ?? null,
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

  res.status(201).json(followUp);
  try {
    await logActivity(req.user?.userId, `create_follow_up_appointment:${followUp.appointmentId}`);
  } catch (_) {}
};

export const rescheduleAppointment = async (req: Request, res: Response) => {
  const appointmentId = Number(req.params.id);
  const { dateTime, notes } = req.body as { dateTime?: string; notes?: string };

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment ID.' });
  }

  const parsedDateTime = parseDateTime(dateTime);
  if (!parsedDateTime) {
    return res.status(400).json({ message: 'Date and time are required.' });
  }

  const appointment = await prisma.appointment.findUnique({ where: { appointmentId } });
  if (!appointment) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }

  const normalizedNotesRaw = typeof notes === 'string' ? notes.trim() : '';
  const normalizedNotes = normalizedNotesRaw.length > 0 ? normalizedNotesRaw : appointment.notes;

  if (appointment.status !== AppointmentStatus.PENDING) {
    return res.status(400).json({ message: 'Only PENDING appointments can be rescheduled.' });
  }

  const conflict = await hasSlotConflict(appointment.doctorId, parsedDateTime, appointmentId);
  if (conflict) {
    return res.status(409).json({ message: 'Selected time slot is already booked.' });
  }

  const updated = await prisma.appointment.update({
    where: { appointmentId },
    data: {
      dateTime: parsedDateTime,
      notes: normalizedNotes,
    },
  });

  res.json(updated);
};

export const cancelAppointment = async (req: Request, res: Response) => {
  const appointmentId = Number(req.params.id);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment ID.' });
  }

  const appointment = await prisma.appointment.findUnique({ where: { appointmentId } });
  if (!appointment) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }

  if (appointment.status !== AppointmentStatus.PENDING) {
    return res.status(400).json({ message: 'Only PENDING appointments can be cancelled.' });
  }

  const updated = await prisma.appointment.update({
    where: { appointmentId },
    data: { status: AppointmentStatus.CANCELLED },
  });

  res.json(updated);
};