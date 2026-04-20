import { Router } from 'express';
import {
	recordPayment,
	listPayments,
	listWalkInMedicines,
	recordWalkInMedicineSale,
} from '../controllers/payment/paymentController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware);

router.get('/walkin-medicines', rbac([Role.RECEPTIONIST]), listWalkInMedicines);
router.post('/walkin-medicine', rbac([Role.RECEPTIONIST]), recordWalkInMedicineSale);
router.get('/', rbac([Role.DOCTOR]), listPayments);
router.post('/', rbac([Role.RECEPTIONIST]), recordPayment);

export default router;
