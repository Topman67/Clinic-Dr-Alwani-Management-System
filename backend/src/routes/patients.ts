import { Router } from 'express';
import {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  deletePatient,
  archivePatient,
  restorePatient,
} from '../controllers/patient/patientController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST, Role.PHARMACIST]));

router.get('/', listPatients);
router.get('/:id', getPatient);

router.post('/', rbac([Role.RECEPTIONIST]), createPatient);
router.put('/:id', rbac([Role.RECEPTIONIST]), updatePatient);
router.put('/:id/archive', rbac([Role.DOCTOR, Role.RECEPTIONIST]), archivePatient);
router.put('/:id/restore', rbac([Role.DOCTOR, Role.RECEPTIONIST]), restorePatient);
router.delete('/:id', rbac([Role.DOCTOR]), deletePatient);

export default router;
