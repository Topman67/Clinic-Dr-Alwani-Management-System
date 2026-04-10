import { Router } from 'express';
import { listUsers, createUser, updateUser, updatePassword, deactivateUser, deleteUser } from '../controllers/userController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();

router.use(authMiddleware, rbac([Role.DOCTOR]));
router.get('/', listUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.put('/:id/password', updatePassword);
router.put('/:id/deactivate', deactivateUser);
router.delete('/:id', deleteUser);

export default router;
