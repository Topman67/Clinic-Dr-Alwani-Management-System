import { Router } from 'express';
import authRoutes from './auth';
import userRoutes from './users';
import patientRoutes from './patients';
import prescriptionRoutes from './prescriptions';
import medicineRoutes from './medicine';
import paymentRoutes from './payments';
import reportRoutes from './reports';
import auditRoutes from './audit';

const router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/patients', patientRoutes);
router.use('/prescriptions', prescriptionRoutes);
router.use('/medicine', medicineRoutes);
router.use('/payments', paymentRoutes);
router.use('/reports', reportRoutes);
router.use('/audit-logs', auditRoutes);

export default router;
