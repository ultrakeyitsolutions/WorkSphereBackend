import { Router } from 'express';
import { SuperAdminSecurityController } from './security.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN authorization on all security routes
router.use(requireSuperAdmin);

// GET /api/superadmin/security/summary
router.get('/summary', SuperAdminSecurityController.getSummary);

// GET /api/superadmin/security/sessions
router.get('/sessions', SuperAdminSecurityController.listSessions);

// GET /api/superadmin/security/events
router.get('/events', SuperAdminSecurityController.listEvents);

export default router;
