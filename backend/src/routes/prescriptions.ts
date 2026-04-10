import { Router } from 'express';
import { createPrescription, listPrescriptions, getPrescription } from '../controllers/prescription/prescriptionController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR, Role.PHARMACIST]));
router.post('/', createPrescription);
router.get('/', listPrescriptions);
router.get('/:id', getPrescription);

export default router;
