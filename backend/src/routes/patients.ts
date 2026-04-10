import { Router } from 'express';
import { createPatient, listPatients, getPatient, updatePatient } from '../controllers/patient/patientController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST, Role.PHARMACIST]));

router.get('/', listPatients);
router.get('/:id', getPatient);

router.post('/', rbac([Role.RECEPTIONIST]), createPatient);
router.put('/:id', rbac([Role.RECEPTIONIST]), updatePatient);

export default router;
