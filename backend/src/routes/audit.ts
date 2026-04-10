import { Router } from 'express';
import { listAuditLogs } from '../controllers/audit/auditController';
import { authMiddleware } from '../middleware/auth';
import { rbac } from '../middleware/rbac';
import { Role } from '@prisma/client';

const router = Router();
router.use(authMiddleware, rbac([Role.DOCTOR]));
router.get('/', listAuditLogs);

export default router;
