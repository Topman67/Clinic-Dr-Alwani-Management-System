import { Router } from 'express';
import { recordPayment, listPayments } from '../controllers/payment/paymentController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware);

router.get('/', rbac([Role.DOCTOR]), listPayments);
router.post('/', rbac([Role.RECEPTIONIST]), recordPayment);

export default router;
