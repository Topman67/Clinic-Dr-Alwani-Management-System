import { Router } from 'express';
import { addMedicine, approveMedicine, rejectMedicine, resubmitMedicine, listMedicine, updateMedicine, deleteMedicine } from '../controllers/medicine/medicineController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR, Role.PHARMACIST]));

router.get('/', listMedicine);
router.post('/', rbac([Role.PHARMACIST]), addMedicine);
router.patch('/:id/approve', rbac([Role.DOCTOR]), approveMedicine);
router.patch('/:id/reject', rbac([Role.DOCTOR]), rejectMedicine);
router.patch('/:id/resubmit', rbac([Role.PHARMACIST]), resubmitMedicine);
router.put('/:id', rbac([Role.PHARMACIST]), updateMedicine);
router.delete('/:id', rbac([Role.PHARMACIST]), deleteMedicine);

export default router;
