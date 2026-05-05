import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import {
  createConsultation,
  getConsultation,
  listConsultations,
  startConsultation,
  updateConsultation,
} from '../controllers/consultation/consultationController';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST]));

router.get('/', listConsultations);
router.get('/:id', getConsultation);
router.post('/', rbac([Role.RECEPTIONIST, Role.DOCTOR]), createConsultation);
router.patch('/:id/start', rbac([Role.DOCTOR]), startConsultation);
router.patch('/:id', rbac([Role.DOCTOR]), updateConsultation);

export default router;
