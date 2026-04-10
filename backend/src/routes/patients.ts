import { Router } from 'express';
import { createPatient, listPatients, getPatient, updatePatient } from '../controllers/patient/patientController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST, Role.PHARMACIST]));
router.post('/', createPatient);
router.get('/', listPatients);
router.get('/:id', getPatient);
router.put('/:id', updatePatient);

export default router;
