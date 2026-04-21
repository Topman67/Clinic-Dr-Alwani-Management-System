import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import {
  cancelAppointment,
  createAppointment,
  createFollowUpAppointment,
  listAppointments,
  rescheduleAppointment,
  startConsultation,
  updateAppointmentStatus,
} from '../controllers/appointment/appointmentController';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST]));

router.get('/', listAppointments);

router.post('/', rbac([Role.RECEPTIONIST]), createAppointment);
router.patch('/:id/status', rbac([Role.RECEPTIONIST]), updateAppointmentStatus);
router.patch('/:id/reschedule', rbac([Role.RECEPTIONIST]), rescheduleAppointment);
router.patch('/:id/cancel', rbac([Role.RECEPTIONIST]), cancelAppointment);

router.post('/:id/start-consultation', rbac([Role.DOCTOR]), startConsultation);
router.post('/:id/follow-up', rbac([Role.DOCTOR]), createFollowUpAppointment);

export default router;