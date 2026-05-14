import { Router } from 'express';
import {
	recordPayment,
	listPayments,
	listPendingPayments,
	confirmPendingPayment,
	listWalkInMedicines,
	listWalkInSales,
	recordWalkInMedicineSale,
	dispenseWalkInSale,
} from '../controllers/payment/paymentController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware);

router.get('/walkin-medicines', rbac([Role.RECEPTIONIST]), listWalkInMedicines);
router.post('/walkin-medicine', rbac([Role.RECEPTIONIST]), recordWalkInMedicineSale);
router.get('/sales', rbac([Role.DOCTOR, Role.RECEPTIONIST, Role.PHARMACIST]), listWalkInSales);
router.get('/walkin-sales', rbac([Role.DOCTOR, Role.RECEPTIONIST, Role.PHARMACIST]), listWalkInSales);
router.get('/pending', rbac([Role.RECEPTIONIST]), listPendingPayments);
router.post('/:id/confirm', rbac([Role.RECEPTIONIST]), confirmPendingPayment);
router.post('/:id/dispense', rbac([Role.PHARMACIST]), dispenseWalkInSale);
router.get('/', rbac([Role.DOCTOR, Role.RECEPTIONIST]), listPayments);
router.post('/', rbac([Role.RECEPTIONIST]), recordPayment);

export default router;
