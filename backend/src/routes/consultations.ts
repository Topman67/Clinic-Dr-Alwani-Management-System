import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import {
  createConsultation,
  createConsultationFollowUp,
  createConsultationMedicalCertificate,
  deleteConsultationMedicalCertificate,
  getConsultation,
  listConsultations,
  startConsultation,
  updateConsultation,
  updateConsultationMedicalCertificate,
  updateConsultationMedicalCertificateStatus,
} from '../controllers/consultation/consultationController';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST]));

router.get('/', listConsultations);
router.get('/:id', getConsultation);
router.post('/', rbac([Role.RECEPTIONIST, Role.DOCTOR]), createConsultation);
router.post('/:id/follow-up', rbac([Role.DOCTOR]), createConsultationFollowUp);
router.post('/:id/medical-certificates', rbac([Role.DOCTOR]), createConsultationMedicalCertificate);
router.patch('/:id/medical-certificates/:mcId', rbac([Role.DOCTOR]), updateConsultationMedicalCertificate);
router.patch('/:id/medical-certificates/:mcId/status', rbac([Role.DOCTOR]), updateConsultationMedicalCertificateStatus);
router.delete('/:id/medical-certificates/:mcId', rbac([Role.DOCTOR]), deleteConsultationMedicalCertificate);
router.patch('/:id/start', rbac([Role.DOCTOR]), startConsultation);
router.patch('/:id', rbac([Role.DOCTOR]), updateConsultation);

export default router;
