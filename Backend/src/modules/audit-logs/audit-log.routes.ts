import { Router } from 'express';
import { AuditLogController } from './audit-log.controller';

const router = Router();

// All routes in this file are already protected by:
//   authenticate + authorizeRoles('SUPER_ADMIN')
// applied in super-admin.routes.ts

// GET /api/super-admin/audit-logs/stats
router.get('/stats', AuditLogController.getStats);

// GET /api/super-admin/audit-logs/company/:companyId
router.get('/company/:companyId', AuditLogController.getByCompany);

// GET /api/super-admin/audit-logs/:id
router.get('/:id', AuditLogController.getOne);

// GET /api/super-admin/audit-logs
router.get('/', AuditLogController.getAll);

export default router;
