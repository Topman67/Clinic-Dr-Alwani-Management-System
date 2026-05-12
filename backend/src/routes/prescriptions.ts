import { Router } from 'express';
import {
  createPrescription,
  dispensePrescription,
  getPrescription,
  listPrescriptions,
  rejectPrescription,
  verifyPrescription,
} from '../controllers/prescription/prescriptionController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware);
router.post('/', rbac([Role.DOCTOR]), createPrescription);
router.get('/', rbac([Role.DOCTOR, Role.PHARMACIST]), listPrescriptions);
router.get('/:id', rbac([Role.DOCTOR, Role.PHARMACIST]), getPrescription);
router.post('/:id/verify', rbac([Role.PHARMACIST]), verifyPrescription);
router.post('/:id/dispense', rbac([Role.PHARMACIST]), dispensePrescription);
router.post('/:id/reject', rbac([Role.PHARMACIST]), rejectPrescription);

export default router;
