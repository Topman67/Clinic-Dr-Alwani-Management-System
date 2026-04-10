import { Router } from 'express';
import { addMedicine, listMedicine, updateMedicine, deleteMedicine } from '../controllers/medicine/medicineController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR, Role.PHARMACIST]));
router.post('/', addMedicine);
router.get('/', listMedicine);
router.put('/:id', updateMedicine);
router.delete('/:id', deleteMedicine);

export default router;
