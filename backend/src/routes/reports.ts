import { Router } from 'express';
import {
	paymentSummary,
	receiptsReport,
	inventoryLowStock,
	inventoryExpiring,
	patientsReport,
	prescriptionsReport,
} from '../controllers/report/reportController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR, Role.RECEPTIONIST, Role.PHARMACIST]));
router.get('/patients', patientsReport);
router.get('/prescriptions', prescriptionsReport);
router.get('/payments', paymentSummary);
router.get('/receipts', receiptsReport);
router.get('/inventory/low-stock', inventoryLowStock);
router.get('/inventory/expiring', inventoryExpiring);

export default router;
