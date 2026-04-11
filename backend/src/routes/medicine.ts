import { Router } from 'express';
import { addMedicine, listMedicine, updateMedicine, deleteMedicine } from '../controllers/medicine/medicineController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR, Role.PHARMACIST]));

router.get('/', listMedicine);
router.post('/', rbac([Role.PHARMACIST]), addMedicine);
router.put('/:id', rbac([Role.PHARMACIST]), updateMedicine);
router.delete('/:id', rbac([Role.PHARMACIST]), deleteMedicine);

export default router;
