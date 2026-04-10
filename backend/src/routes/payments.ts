import { Router } from 'express';
import { recordPayment, listPayments } from '../controllers/payment/paymentController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST]));
router.post('/', recordPayment);
router.get('/', listPayments);

export default router;
