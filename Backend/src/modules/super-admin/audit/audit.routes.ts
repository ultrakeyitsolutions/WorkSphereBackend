import { Router } from 'express';
import { SuperAdminAuditController } from './audit.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN check on all audit routes
router.use(requireSuperAdmin);

// GET /api/superadmin/audit/logs
router.get('/logs', SuperAdminAuditController.listLogs);

// GET /api/superadmin/audit/logs/:auditId
router.get('/logs/:auditId', SuperAdminAuditController.getLogById);

export default router;
